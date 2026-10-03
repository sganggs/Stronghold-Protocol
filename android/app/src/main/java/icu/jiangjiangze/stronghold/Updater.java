package icu.jiangjiangze.stronghold;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import javax.net.ssl.HttpsURLConnection;

/**
 * Hot update (最终执行方案-服务器清单与热更新.md §4).
 *
 * The manifest is a signed document naming the current build tag, the slim content bundle
 * (L1: index.html/data.js/js/css/vendor/fonts/shared/sim/data/server/package.json/node_modules)
 * and where to fetch it. Because the bundle is upstream content, the shell re-applies its own
 * extras and patches after extraction — without that step a hot update would silently drop the
 * bridge scripts and the DC wiring.
 *
 * Order: signed manifest → mirror chain download (sha256-verified) → L1-only extraction →
 * extras + patches (anchor-asserted) → CDN manifest transform → atomic swap → health flag.
 * Any failure keeps the old tree and points the player at the APK download.
 */
public final class Updater {

    public static final String META_FILE = "webroot.meta.json";
    /** Marker written at swap time and cleared once the new tree actually renders. */
    public static final String HEALTH_FILE = "webroot.pending";

    /** Hosts the updater may ever talk to. Anything else — including redirects — is rejected. */
    private static final List<String> ALLOWED_HOSTS = Arrays.asList(
            "update.example.com", "art-cdn.example.com",
            "stronghold.example.com", "stronghold2.example.com",
            "mirror.example.com", "mirror2.example.com",
            "ghfast.top", "gh-proxy.com", "gh.llkk.cc", "ghproxy.net",
            "api.github.com", "github.com", "objects.githubusercontent.com",
            "release-assets.githubusercontent.com", "codeload.github.com");

    /** Mirror chain, in order; each entry is a URL prefix applied to the canonical asset URL. */
    private static final String[][] MIRRORS = {
            {"ghfast", "https://ghfast.top/"},
            {"ghproxy", "https://gh-proxy.com/"},
            {"llkk", "https://gh.llkk.cc/"},
            {"ghproxynet", "https://ghproxy.net/"},
            {"r2", ""},   // R2-hosted copy is fetched directly
            {"box", ""},  // box-hosted copy is fetched directly
    };

    private static final String[] MANIFEST_URLS = {
            "https://update.example.com/manifest.json",
            "https://art-cdn.example.com/manifest.json",
    };
    private static final String BUILTIN_MANIFEST = "shell/manifest.json";
    /** Where the "download the newest APK instead" prompt points (the update failed for good). */
    public static final String APK_PAGE = "https://stronghold-download.pages.dev/";

    private static final String[] SLIM_TOP = {
            "index.html", "data.js", "js", "css", "vendor", "fonts", "shared", "sim", "data",
            "server", "package.json", "node_modules"};

    /** CDN base the manifests point at after an update (mirrors build-webroot's SP_CDN_BASE). */
    private static final String CDN_BASE = "https://art-cdn.example.com";
    /** Where slim bundles are mirrored on R2 (apk/ prefix of the assets bucket). */
    private static final String R2_BUNDLE_BASE = "https://art-cdn.example.com/apk/";

    public interface Progress {
        void onStage(String stage);

        void onProgress(long bytes, long total);
    }

    /** The signed hot-update manifest. */
    public static final class Manifest {
        public String buildTag = "";
        public String upstreamTag = "";
        public int minApk = 0;
        public String slimUrl = "";
        public String slimSha256 = "";
        public long slimSize = 0;
        public String artBase = "";
        public String keyId = "";

        boolean usable() {
            return !buildTag.isEmpty() && !slimUrl.isEmpty();
        }
    }

    private Updater() {}

    // ------------------------------------------------------------------
    // Installed state
    // ------------------------------------------------------------------

    /** Installed content tag, or null when only the bundled copy exists. */
    public static String installedTag(Context ctx) {
        File meta = new File(new File(ctx.getFilesDir(), META_FILE), "meta.json");
        if (!meta.isFile()) return null;
        try (FileInputStream in = new FileInputStream(meta)) {
            byte[] buf = new byte[512];
            int n = in.read(buf);
            String s = new String(buf, 0, Math.max(0, n), StandardCharsets.UTF_8);
            return s.replaceAll("[^0-9A-Za-z.\\-]", "");
        } catch (IOException e) {
            return null;
        }
    }

    static void writeInstalledTag(Context ctx, String tag) throws IOException {
        File dir = new File(ctx.getFilesDir(), META_FILE);
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) throw new IOException("mkdirs failed");
        try (FileOutputStream out = new FileOutputStream(new File(dir, "meta.json"))) {
            out.write(tag.getBytes(StandardCharsets.UTF_8));
        }
    }

    /** The build tag the running content corresponds to (hot-updated tag, else the APK's). */
    public static String currentBuildTag(Context ctx) {
        String installed = installedTag(ctx);
        return installed != null ? installed : "shell-v" + BuildConfig.VERSION_NAME;
    }

    // ------------------------------------------------------------------
    // Manifest
    // ------------------------------------------------------------------

    /** Fetches and verifies the manifest from EVERY source and returns the NEWEST one. A stale
     *  mirror can no longer shadow a fresh one (the dl source once served v2.6.0 while R2 already
     *  had v2.6.1, and "first verified wins" made devices miss the update entirely). */
    public static Manifest fetchManifest(Context ctx) {
        byte[] pub = ServerList.publicKey(ctx);
        Manifest best = null;
        if (pub != null) {
            for (String url : MANIFEST_URLS) {
                if (!ServerList.isPublicHttpUrl(url)) continue;
                String body = httpGet(url);
                if (body == null) continue;
                Manifest m = parseVerified(body, pub);
                if (m != null && m.usable()
                        && (best == null || compareBuildTags(m.buildTag, best.buildTag) > 0)) {
                    best = m;
                }
            }
        }
        Manifest builtin = parseVerified(readAsset(ctx, BUILTIN_MANIFEST), pub);
        if (builtin != null && builtin.usable()
                && (best == null || compareBuildTags(builtin.buildTag, best.buildTag) > 0)) {
            best = builtin;
        }
        return best;
    }

    static Manifest parseVerified(String json, byte[] pub) {
        if (json == null || pub == null) return null;
        try {
            JSONObject doc = new JSONObject(json);
            if (!ServerList.verifyDoc(doc, pub)) return null;
            Manifest m = new Manifest();
            m.buildTag = doc.optString("buildTag", "");
            m.upstreamTag = doc.optString("upstreamTag", "");
            m.minApk = doc.optInt("minApk", 0);
            m.keyId = doc.optString("keyId", "");
            JSONObject slim = doc.optJSONObject("slim");
            if (slim != null) {
                m.slimUrl = slim.optString("url", "");
                m.slimSha256 = slim.optString("sha256", "");
                m.slimSize = slim.optLong("size", 0);
            }
            JSONObject art = doc.optJSONObject("art");
            if (art != null) m.artBase = art.optString("base", "");
            return m;
        } catch (Exception e) {
            return null;
        }
    }

    /** True only when the manifest describes content STRICTLY newer than installed — a stale
     *  mirror must never DOWNGRADE a device (string inequality would happily do that). */
    public static boolean needsUpdate(Context ctx, Manifest m) {
        if (m == null || !m.usable()) return false;
        return compareBuildTags(m.buildTag, currentBuildTag(ctx)) > 0;
    }

    /** Numeric build-tag comparison ("shell-v2.6.10" > "shell-v2.6.9"); unparseable tags fall
     *  back to plain string comparison so an unexpected scheme can never throw. */
    public static int compareBuildTags(String a, String b) {
        long[] pa = parseTag(a);
        long[] pb = parseTag(b);
        if (pa == null || pb == null) {
            return String.valueOf(a).compareTo(String.valueOf(b));
        }
        for (int i = 0; i < 3; i++) {
            if (pa[i] != pb[i]) return pa[i] < pb[i] ? -1 : 1;
        }
        return 0;
    }

    private static long[] parseTag(String tag) {
        if (tag == null) return null;
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("(\\d+)\\.(\\d+)\\.(\\d+)").matcher(tag);
        if (!m.find()) return null;
        try {
            return new long[] { Long.parseLong(m.group(1)), Long.parseLong(m.group(2)),
                    Long.parseLong(m.group(3)) };
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** minApk gate: a manifest built for a newer shell cannot be hot-updated — go get the APK. */
    public static boolean requiresNewApk(Manifest m) {
        return m != null && m.minApk > BuildConfig.VERSION_CODE;
    }

    // ------------------------------------------------------------------
    // Hot update
    // ------------------------------------------------------------------

    /** Downloads, verifies and installs the slim bundle; throws (old tree kept) on any failure. */
    public static void hotUpdate(Context ctx, Manifest m, Progress progress) throws IOException {
        if (m == null || !m.usable()) throw new IOException("清单不可用");
        if (requiresNewApk(m)) throw new IOException("需要新版应用（minApk " + m.minApk + "）");

        File files = ctx.getFilesDir();
        File staging = new File(files, "webroot.staging");
        File tmpZip = new File(files, "update-slim.zip");
        File dst = HostService.contentRoot(ctx);
        File old = new File(files, "webroot.old");

        if (files.getUsableSpace() < 2L * 1024 * 1024 * 1024) throw new IOException("剩余空间不足（需要约 2GB）");
        rm(staging);
        rm(tmpZip);

        progress.onStage("下载更新包");
        long total = downloadWithMirrors(m, tmpZip, progress);

        progress.onStage("校验");
        if (!m.slimSha256.isEmpty()) {
            String got = sha256(tmpZip);
            if (!got.equalsIgnoreCase(m.slimSha256)) {
                rm(tmpZip);
                throw new IOException("校验失败（sha256 不符）");
            }
        }

        progress.onStage("解压");
        extractSlim(tmpZip, staging);
        if (!new File(staging, "server/index.js").isFile()) throw new IOException("内容包不完整（缺 server）");

        progress.onStage("应用外壳补丁");
        applyExtras(ctx, staging);
        applyPatches(ctx, staging);

        transformManifests(new File(staging, "data"));

        progress.onStage("切换版本");
        try (FileOutputStream stampOut = new FileOutputStream(new File(staging, HostService.STAMP_NAME))) {
            stampOut.write((HostService.UPDATED_PREFIX + m.buildTag).getBytes(StandardCharsets.UTF_8));
        }
        rm(old);
        if (dst.isDirectory() && !dst.renameTo(old)) throw new IOException("无法切换旧目录");
        if (!staging.renameTo(dst)) throw new IOException("无法启用新目录");
        // keep webroot.old until the new tree proves it renders (rollback on next cold start)
        writeHealthFlag(ctx);
        writeInstalledTag(ctx, m.buildTag);
        rm(tmpZip);
        progress.onStage("完成 " + total / (1024 * 1024) + "MB");
    }

    /** Downloads over the mirror chain, resuming a partial file when the server allows it. */
    private static long downloadWithMirrors(Manifest m, File dst, Progress progress) throws IOException {
        List<String> candidates = new ArrayList<>();
        for (String[] mirror : MIRRORS) {
            if (mirror[1].isEmpty()) continue; // r2/box are added explicitly below
            candidates.add(mirror[1] + m.slimUrl);
        }
        // the R2 copy is derived from the build tag, so it works even when the GitHub asset is
        // missing and every mirror prefix (which only understands GitHub URLs) 404s
        candidates.add(R2_BUNDLE_BASE + "content-slim-" + m.buildTag + ".zip");
        candidates.add(m.slimUrl);
        IOException last = null;
        for (String candidate : candidates) {
            try {
                return downloadOne(candidate, dst, progress);
            } catch (IOException e) {
                last = e;
            }
        }
        throw last != null ? last : new IOException("下载失败");
    }

    private static long downloadOne(String spec, File dst, Progress progress) throws IOException {
        URL u = new URL(spec);
        long have = dst.isFile() ? dst.length() : 0;
        HttpURLConnection c = open(u, 15000, 30000);
        if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
        int status = c.getResponseCode();
        if (status >= 301 && status <= 308) {
            String loc = c.getHeaderField("Location");
            c.disconnect();
            if (loc == null) throw new IOException("redirect without Location");
            URL next = new URL(u, loc);
            open(next, 15000, 30000).disconnect(); // validates the hop before following it
            return downloadOne(next.toString(), dst, progress);
        }
        boolean resuming = have > 0 && status == 206;
        if (status != 200 && status != 206) {
            c.disconnect();
            throw new IOException("HTTP " + status);
        }
        long total = c.getContentLengthLong() + (resuming ? have : 0);
        try (InputStream in = c.getInputStream();
             OutputStream out = new FileOutputStream(dst, resuming)) {
            byte[] buf = new byte[128 * 1024];
            long done = resuming ? have : 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (progress != null) progress.onProgress(done, total);
            }
            return done;
        } finally {
            c.disconnect();
        }
    }

    /** Extracts only the L1 (slim) paths from the bundle; everything else never lands on disk. */
    private static void extractSlim(File zip, File staging) throws IOException {
        try (ZipInputStream zin = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[128 * 1024];
            while ((e = zin.getNextEntry()) != null) {
                String rel = slimEntry(e.getName());
                if (rel == null) continue;
                File out = new File(staging, rel);
                if (!out.getCanonicalPath().startsWith(staging.getCanonicalPath() + File.separator)) continue;
                if (e.isDirectory()) {
                    out.mkdirs();
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) {
                    throw new IOException("mkdirs failed: " + parent);
                }
                try (OutputStream os = new FileOutputStream(out)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) os.write(buf, 0, n);
                }
            }
        }
    }

    /** Archive path → slim relative path, or null when the entry is outside the L1 set. */
    static String slimEntry(String name) {
        String p = name.replace('\\', '/');
        while (p.startsWith("/")) p = p.substring(1);
        int slash = p.indexOf('/');
        if (slash > 0) p = p.substring(slash + 1); // strip the wrapper folder
        if (p.isEmpty()) return null;
        if (p.startsWith("public/")) {
            String sub = p.substring("public/".length());
            if (sub.startsWith("dev/") || sub.equals("dev")) return null;
            if (sub.startsWith("assets/") || sub.equals("assets")) return null; // L2 art: CDN only
            p = sub;
        }
        for (String top : SLIM_TOP) {
            if (p.equals(top) || p.startsWith(top + "/")) return p;
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Shell-owned overlays (extras + patches), bundled as assets
    // ------------------------------------------------------------------

    /** Copies assets/shell/extras/** over the staging tree (bridge scripts, panels, DC bridge). */
    private static void applyExtras(Context ctx, File staging) throws IOException {
        copyAssetTree(ctx, "shell/extras/public", staging);
        copyAssetTree(ctx, "shell/extras/server", new File(staging, "server"));
    }

    private static void copyAssetTree(Context ctx, String assetDir, File targetDir) throws IOException {
        String[] kids = ctx.getAssets().list(assetDir);
        if (kids == null || kids.length == 0) return;
        for (String kid : kids) {
            String childAsset = assetDir + "/" + kid;
            String[] grand = ctx.getAssets().list(childAsset);
            if (grand != null && grand.length > 0) {
                copyAssetTree(ctx, childAsset, new File(targetDir, kid));
            } else {
                File out = new File(targetDir, kid);
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs() && !parent.isDirectory()) {
                    throw new IOException("mkdirs failed: " + parent);
                }
                try (InputStream in = ctx.getAssets().open(childAsset);
                     OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
            }
        }
    }

    /**
     * Replays assets/shell/patches/*.json ({file, find, replace}). A missing anchor aborts the
     * update rather than shipping a tree where the bridge tags silently vanished.
     */
    private static void applyPatches(Context ctx, File staging) throws IOException {
        String[] files = ctx.getAssets().list("shell/patches");
        if (files == null || files.length == 0) return;
        Arrays.sort(files);
        for (String name : files) {
            if (!name.endsWith(".json")) continue;
            JSONObject spec;
            try {
                spec = new JSONObject(readAsset(ctx, "shell/patches/" + name));
            } catch (org.json.JSONException e) {
                throw new IOException("补丁文件解析失败：" + name);
            }
            JSONArray patches = spec.optJSONArray("patches");
            if (patches == null) continue;
            for (int i = 0; i < patches.length(); i++) {
                JSONObject p = patches.optJSONObject(i);
                if (p == null) continue;
                String file = p.optString("file", "");
                String find = p.optString("find", "");
                String replace = p.optString("replace", "");
                File target = new File(staging, file);
                if (!target.isFile()) throw new IOException("补丁目标缺失：" + file);
                String text = new String(java.nio.file.Files.readAllBytes(target.toPath()), StandardCharsets.UTF_8);
                if (!text.contains(find)) throw new IOException("补丁锚点未命中：" + file);
                java.nio.file.Files.write(target.toPath(),
                        text.replace(find, replace).getBytes(StandardCharsets.UTF_8));
            }
        }
    }

    // ------------------------------------------------------------------
    // Health flag / rollback
    // ------------------------------------------------------------------

    private static void writeHealthFlag(Context ctx) throws IOException {
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), HEALTH_FILE))) {
            out.write("pending".getBytes(StandardCharsets.UTF_8));
        }
    }

    /**
     * Called from onPageFinished; keeps the new tree and drops the rollback copy — but ONLY when
     * an update is actually pending AND the finished page was served from the local tree. Without
     * that guard, loading ANY external page after a hot update (server switch, 免责声明 consent
     * flow, remote-client mode) would consume the rollback copy before the new tree ever rendered.
     */
    public static void markHealthy(Context ctx, boolean pageFromLocalTree) {
        if (!pageFromLocalTree) return; // an external/consent page says nothing about the new tree
        File flag = new File(ctx.getFilesDir(), HEALTH_FILE);
        if (!flag.exists()) return;
        //noinspection ResultOfMethodCallIgnored
        flag.delete();
        rm(new File(ctx.getFilesDir(), "webroot.old"));
    }

    /** True while a hot update awaits its first successful render of the local tree. */
    public static boolean healthPending(Context ctx) {
        return new File(ctx.getFilesDir(), HEALTH_FILE).exists();
    }

    /** At cold start: a pending flag means the previous update never rendered → roll back. */
    public static void rollbackIfUnhealthy(Context ctx) {
        File flag = new File(ctx.getFilesDir(), HEALTH_FILE);
        File old = new File(ctx.getFilesDir(), "webroot.old");
        if (!flag.exists() || !old.isDirectory()) return;
        File dst = HostService.contentRoot(ctx);
        File failed = new File(ctx.getFilesDir(), "webroot.failed");
        rm(failed);
        if (dst.isDirectory() && dst.renameTo(failed)) {
            if (old.renameTo(dst)) {
                rm(failed);
                rm(new File(new File(ctx.getFilesDir(), META_FILE), "meta.json"));
            } else {
                //noinspection ResultOfMethodCallIgnored
                failed.renameTo(dst);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        flag.delete();
    }

    // ------------------------------------------------------------------
    // Network / hashing / assets
    // ------------------------------------------------------------------

    private static HttpURLConnection open(URL url, int connMs, int readMs) throws IOException {
        String proto = url.getProtocol();
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equals(proto)) throw new IOException("non-https");
        if (!ALLOWED_HOSTS.contains(host)) throw new IOException("host not allowed: " + host);
        if (isLocalOrPrivateLiteral(host)) throw new IOException("private host rejected");
        HttpsURLConnection c = (HttpsURLConnection) url.openConnection();
        c.setConnectTimeout(connMs);
        c.setReadTimeout(readMs);
        c.setInstanceFollowRedirects(false); // redirects are followed manually, one validated hop at a time
        c.setRequestProperty("User-Agent", "stronghold-shell");
        return c;
    }

    private static boolean isLocalOrPrivateLiteral(String host) {
        if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".local")
                || host.endsWith(".internal")) return true;
        if (!host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        String[] parts = host.split("\\.");
        int a = Integer.parseInt(parts[0]);
        int b = Integer.parseInt(parts[1]);
        if (a == 10 || a == 127 || a == 0) return true;
        if (a == 169 && b == 254) return true;
        if (a == 172 && b >= 16 && b <= 31) return true;
        if (a == 192 && b == 168) return true;
        if (a == 100 && b >= 64 && b <= 127) return true;
        return a >= 224;
    }

    private static String httpGet(String url) {
        if (!ServerList.isPublicHttpUrl(url)) return null;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(6000);
            c.setRequestProperty("User-Agent", "stronghold-shell");
            if (c.getResponseCode() != 200) return null;
            return ServerList.readAll(c.getInputStream());
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    static String sha256(File f) throws IOException {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            try (InputStream in = new FileInputStream(f)) {
                byte[] buf = new byte[128 * 1024];
                int n;
                while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            }
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder(64);
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IOException("SHA-256 unavailable", e);
        }
    }

    private static String readAsset(Context ctx, String name) {
        try (InputStream in = ctx.getAssets().open(name)) {
            return ServerList.readAll(in);
        } catch (IOException e) {
            return null;
        }
    }

    /** "/assets/..." → CDN absolute URLs in the manifest JSONs (plain text rewrite, no parsing). */
    private static void transformManifests(File dataDir) {
        for (String name : new String[] { "assets.json", "local-assets.json" }) {
            File f = new File(dataDir, name);
            if (!f.isFile()) continue;
            try {
                String text = new String(java.nio.file.Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8);
                String transformed = text.replace("\"/assets/", "\"" + CDN_BASE + "/assets/");
                java.nio.file.Files.write(f.toPath(), transformed.getBytes(StandardCharsets.UTF_8));
            } catch (IOException ignored) {
                // a malformed manifest only means no CDN rewrite for that file; the update still lands
            }
        }
    }

    private static void rm(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) rm(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    @SuppressWarnings("unused")
    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }
}
