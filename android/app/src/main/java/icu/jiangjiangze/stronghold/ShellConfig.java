package icu.jiangjiangze.stronghold;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

import javax.net.ssl.HttpsURLConnection;

/**
 * Remotely editable shell configuration ("可热更新网址"). The APK hardcodes only two
 * bootstrap URLs (both on the box's stable CF domain + a static mirror); everything
 * else — directory service URLs, fallback origins, STUN list, announcement — lives in
 * config.json, so changing any URL is a one-file edit on the box that every APK picks
 * up on next start. The last successful copy is cached in filesDir for offline use.
 */
public final class ShellConfig {

    private static final String[] BOOTSTRAP = {
            "https://stronghold.example.com/dl/config.json",
    };
    private static final String CACHE = "shell-config.json";

    /** Defaults are compiled in; the remote config overrides/adds to these. */
    private JSONObject json;

    private ShellConfig(JSONObject json) {
        this.json = json;
    }

    public static ShellConfig load(Context ctx) {
        // cached copy first (works offline), then defaults under it
        JSONObject cached = readCache(ctx);
        JSONObject base = defaults();
        if (cached != null) base = merge(base, cached);
        return new ShellConfig(base);
    }

    /** Tries each bootstrap URL; the first success is merged over the current view and cached. */
    public boolean refresh(Context ctx) {
        for (String url : BOOTSTRAP) {
            try {
                HttpURLConnection c = open(url, 8000, 8000);
                int code = c.getResponseCode();
                String body = code == 200 ? readAll(c.getInputStream()) : null;
                c.disconnect();
                if (body == null) continue;
                JSONObject remote = new JSONObject(body);
                JSONObject merged = merge(defaults(), remote);
                json = merged;
                writeCache(ctx, merged);
                return true;
            } catch (Exception ignored) {
                // try the next bootstrap
            }
        }
        return false;
    }

    public List<String> directoryUrls() {
        return stringList("directoryUrls", "https://directory.example.com");
    }

    public List<String> fallbackOrigins() {
        return stringList("fallbackOrigins",
                "https://map.u712507.nyat.app:38916",
                "https://stronghold.example.com",
                "https://stronghold2.example.com",
                "https://mirror2.example.com");
    }

    public List<String> stunUrls() {
        return stringList("stunUrls",
                "stun:stun.qq.com:3478", "stun:stun.miwifi.com:3478", "stun:stun.l.google.com:19302");
    }

    public String announce() {
        return json.optString("announce", "");
    }

    public String configVersion() {
        return json.optString("configVersion", "builtin");
    }

    // ------------------------------------------------------------------

    private static JSONObject defaults() {
        try {
            return new JSONObject()
                    .put("directoryUrls", new JSONArray().put("https://directory.example.com"))
                    .put("fallbackOrigins", new JSONArray()
                            .put("https://map.u712507.nyat.app:38916")
                            .put("https://stronghold.example.com")
                            .put("https://stronghold2.example.com")
                            .put("https://mirror2.example.com"))
                    .put("stunUrls", new JSONArray()
                            .put("stun:stun.qq.com:3478")
                            .put("stun:stun.miwifi.com:3478")
                            .put("stun:stun.l.google.com:19302"))
                    .put("configVersion", "builtin");
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static JSONObject merge(JSONObject base, JSONObject override) {
        try {
            JSONObject out = new JSONObject(base.toString());
            Iterator<String> keys = override.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                out.put(k, override.opt(k));
            }
            return out;
        } catch (org.json.JSONException e) {
            return base; // keep the built-in defaults if a remote entry is malformed
        }
    }

    private List<String> stringList(String key, String... fallback) {
        List<String> out = new ArrayList<>();
        JSONArray arr = json.optJSONArray(key);
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                String v = arr.optString(i, "");
                if (!v.isEmpty() && v.startsWith("https://")) out.add(v);
            }
        }
        if (out.isEmpty()) for (String f : fallback) out.add(f);
        return out;
    }

    private static JSONObject readCache(Context ctx) {
        try (FileInputStream in = new FileInputStream(new File(ctx.getFilesDir(), CACHE))) {
            byte[] buf = new byte[8192];
            int n = in.read(buf);
            if (n <= 0) return null;
            return new JSONObject(new String(buf, 0, n, StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    private static void writeCache(Context ctx, JSONObject o) {
        try (FileOutputStream out = new FileOutputStream(new File(ctx.getFilesDir(), CACHE))) {
            out.write(o.toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException ignored) {
        }
    }

    private static HttpURLConnection open(String spec, int connMs, int readMs) throws IOException {
        URL url = new URL(spec);
        String proto = url.getProtocol();
        String host = url.getHost() == null ? "" : url.getHost().toLowerCase(java.util.Locale.ROOT);
        if (!"https".equals(proto)) throw new IOException("non-https");
        if (host.equals("localhost") || host.endsWith(".localhost") || host.endsWith(".internal")) {
            throw new IOException("private host rejected");
        }
        if (host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) throw new IOException("ip literals rejected");
        HttpsURLConnection c = (HttpsURLConnection) url.openConnection();
        c.setConnectTimeout(connMs);
        c.setReadTimeout(readMs);
        c.setRequestProperty("User-Agent", "stronghold-shell");
        return c;
    }

    private static String readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }
}
