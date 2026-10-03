package icu.jiangjiangze.stronghold;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Editable embedded-server parameters (房主可编辑参数). Chinese labels and notes live
 * here so the editor stays in sync with the value domains. Defaults are the safe
 * ones for a phone: client-side combat, no verification re-sim, dual-stack listen.
 * Any change requires an app restart (node::Start cannot be re-entered in-process).
 */
public final class HostParams {

    public final int port;          // 1024–65535
    public final String hostBind;   // "::" (dual-stack) | "127.0.0.1" (loopback only)
    public final String spCombat;   // "client" | "server"
    public final String spVerify;   // "off" | "sample" | "all"
    public final String trustProxy; // "auto" | "1" | "0"

    private HostParams(int port, String hostBind, String spCombat, String spVerify, String trustProxy) {
        this.port = port;
        this.hostBind = hostBind;
        this.spCombat = spCombat;
        this.spVerify = spVerify;
        this.trustProxy = trustProxy;
    }

    public static HostParams load(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences("host_params", Context.MODE_PRIVATE);
        return new HostParams(
                clamp(p.getInt("port", 3000), 1024, 65535),
                p.getString("hostBind", "::"),
                p.getString("spCombat", "client"),
                p.getString("spVerify", "off"),
                p.getString("trustProxy", "auto"));
    }

    public static void save(Context ctx, int port, String hostBind, String spCombat,
                            String spVerify, String trustProxy) {
        ctx.getSharedPreferences("host_params", Context.MODE_PRIVATE).edit()
                .putInt("port", clamp(port, 1024, 65535))
                .putString("hostBind", "::".equals(hostBind) ? hostBind : "127.0.0.1")
                .putString("spCombat", "server".equals(spCombat) ? "server" : "client")
                .putString("spVerify", "sample".equals(spVerify) || "all".equals(spVerify) ? spVerify : "off")
                .putString("trustProxy", "1".equals(trustProxy) || "0".equals(trustProxy) ? trustProxy : "auto")
                .apply();
    }

    private static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : Math.min(v, hi);
    }
}
