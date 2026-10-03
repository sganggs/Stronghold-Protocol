package icu.jiangjiangze.stronghold;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;

/**
 * The canonical JSON form the Ed25519 signature is computed over — the Java twin of
 * tools/apk/canonical.mjs. The document is serialized as UTF-8 with object keys sorted
 * recursively, no insignificant whitespace, no trailing newline, arrays preserved; the
 * top-level {@code sig} field is excluded.
 *
 * Both sides must produce byte-identical output or every signature would fail to verify,
 * so the escaping rules mirror JavaScript's JSON.stringify (escape only the quote, the
 * backslash and C0 controls; emit non-ASCII literally) rather than org.json's own writer,
 * which escapes differently.
 */
final class CanonicalJson {

    private CanonicalJson() {}

    /** Canonical bytes of a signed document, ignoring its `sig` field. */
    static byte[] canonicalBytes(JSONObject doc) {
        JSONObject rest = new JSONObject();
        Iterator<String> keys = doc.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            if ("sig".equals(k)) continue;
            try {
                rest.put(k, doc.get(k));
            } catch (org.json.JSONException ignored) {
                // an unreadable key cannot be part of a valid signature
            }
        }
        return canonical(rest).getBytes(java.nio.charset.StandardCharsets.UTF_8);
    }

    static String canonical(Object value) {
        if (value == null || value == JSONObject.NULL) return "null";
        if (value instanceof String) return quote((String) value);
        if (value instanceof Boolean) return ((Boolean) value) ? "true" : "false";
        if (value instanceof JSONArray) {
            JSONArray arr = (JSONArray) value;
            StringBuilder sb = new StringBuilder("[");
            for (int i = 0; i < arr.length(); i++) {
                if (i > 0) sb.append(',');
                sb.append(canonical(arr.opt(i)));
            }
            return sb.append(']').toString();
        }
        if (value instanceof JSONObject) {
            JSONObject obj = (JSONObject) value;
            List<String> keys = new ArrayList<>();
            Iterator<String> it = obj.keys();
            while (it.hasNext()) {
                String k = it.next();
                if (obj.opt(k) != null) keys.add(k);
            }
            Collections.sort(keys);
            StringBuilder sb = new StringBuilder("{");
            for (int i = 0; i < keys.size(); i++) {
                if (i > 0) sb.append(',');
                sb.append(quote(keys.get(i))).append(':').append(canonical(obj.opt(keys.get(i))));
            }
            return sb.append('}').toString();
        }
        if (value instanceof Number) return number((Number) value);
        throw new IllegalArgumentException("unsupported value type: " + value.getClass());
    }

    /** Integers only — the manifests carry no floats, and only integer text matches in both languages. */
    private static String number(Number n) {
        if (n instanceof Integer || n instanceof Long || n instanceof Short || n instanceof Byte) {
            return n.toString();
        }
        double d = n.doubleValue();
        if (Double.isFinite(d) && d == Math.rint(d)) return String.valueOf((long) d);
        throw new IllegalArgumentException("non-integer number in payload: " + n);
    }

    /** JSON.stringify-compatible string escaping: only ", \ and C0 controls; non-ASCII passes through. */
    private static String quote(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b"); break;
                case '\f': sb.append("\\f"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }
}
