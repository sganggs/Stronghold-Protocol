package icu.jiangjiangze.stronghold;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Minimal Ed25519 (RFC 8032) signature verification, pure Java.
 *
 * The shell's minSdk is 26, but Android's native Ed25519 (Conscrypt) only exists from API 28,
 * so a self-contained verifier is required to check the signed server list and the hot-update
 * manifest on every supported device. Verification only — signing lives in tools/apk/sign.mjs
 * and the private key never ships inside the APK.
 *
 * Field layout follows TweetNaCl (16 limbs of 16 bits), which keeps the arithmetic short enough
 * to audit against the reference implementation. Entry point: {@link #verify(byte[], byte[], byte[])}.
 */
final class Ed25519 {

    private Ed25519() {}

    /** Curve constant d. */
    private static final long[] D = {
            0x78a3, 0x1359, 0x4dca, 0x75eb, 0xd8ab, 0x4141, 0x0a4d, 0x0070,
            0xe898, 0x7779, 0x4079, 0x8cc7, 0xfe73, 0x2b6f, 0x6cee, 0x5203};
    /** 2*d, used by the twisted-Edwards addition. */
    private static final long[] D2 = {
            0xf159, 0x26b2, 0x9b94, 0xebd6, 0xb156, 0x8283, 0x149a, 0x00e0,
            0xd130, 0xeef3, 0x80f2, 0x198e, 0xfce7, 0x56df, 0xd9dc, 0x2406};
    /** Base point x. */
    private static final long[] X = {
            0xd51a, 0x8f25, 0x2d60, 0xc956, 0xa7b2, 0x9525, 0xc760, 0x692c,
            0xdc5c, 0xfdd6, 0xe231, 0xc0a4, 0x53fe, 0xcd6e, 0x36d3, 0x2169};
    /** Base point y. */
    private static final long[] Y = {
            0x6658, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666,
            0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666, 0x6666};
    /** sqrt(-1). */
    private static final long[] I = {
            0xa0b0, 0x4a0e, 0x1b27, 0xc4ee, 0xe478, 0xad2f, 0x1806, 0x2f43,
            0xd7a7, 0x3dfb, 0x0099, 0x2b4d, 0xdf0b, 0x4fc1, 0x2480, 0x2b83};

    /** Group order L, little-endian limbs (the SHA-512 output is reduced modulo it). */
    private static final long[] L = {
            0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10};

    /**
     * Verifies an Ed25519 signature.
     *
     * @param msg message bytes that were signed
     * @param sig 64-byte signature (R || S)
     * @param pk  32-byte public key
     * @return true when the signature is valid for this message and key
     */
    static boolean verify(byte[] msg, byte[] sig, byte[] pk) {
        if (msg == null || sig == null || sig.length != 64 || pk == null || pk.length != 32) {
            return false;
        }
        long[][] q = new long[4][];
        if (unpackneg(q, pk) != 0) return false;

        // h = SHA-512(R || A || M)
        byte[] in = new byte[64 + msg.length];
        System.arraycopy(sig, 0, in, 0, 32);
        System.arraycopy(pk, 0, in, 32, 32);
        System.arraycopy(msg, 0, in, 64, msg.length);
        byte[] h = sha512(in);
        reduce(h);

        // p = h*A + S*B ; valid iff pack(p) == R
        long[][] p = new long[4][];
        scalarmult(p, q, h);

        long[][] sB = new long[4][];
        byte[] s = new byte[32];
        System.arraycopy(sig, 32, s, 0, 32);
        scalarbase(sB, s);
        pointAdd(p, sB);

        byte[] t = new byte[32];
        pack(t, p);
        return verify32(sig, 0, t, 0);
    }

    // ------------------------------------------------------------------
    // Field arithmetic (16 x 16-bit limbs)
    // ------------------------------------------------------------------

    private static long[] gf() {
        return new long[16];
    }

    private static long[] gfOne() {
        long[] a = new long[16];
        a[0] = 1;
        return a;
    }

    private static void set(long[] dst, long[] src) {
        System.arraycopy(src, 0, dst, 0, 16);
    }

    private static void car25519(long[] o) {
        for (int i = 0; i < 16; i++) {
            o[i] += 1L << 16;
            long c = o[i] >> 16;
            if (i < 15) o[i + 1] += c - 1;
            else o[0] += 38 * (c - 1);
            o[i] -= c << 16;
        }
    }

    private static void sel25519(long[] p, long[] q, int b) {
        long c = ~(long) (b - 1);
        for (int i = 0; i < 16; i++) {
            long t = c & (p[i] ^ q[i]);
            p[i] ^= t;
            q[i] ^= t;
        }
    }

    private static void pack25519(byte[] o, long[] n) {
        long[] t = new long[16];
        long[] m = new long[16];
        set(t, n);
        car25519(t);
        car25519(t);
        car25519(t);
        for (int j = 0; j < 2; j++) {
            m[0] = t[0] - 0xffed;
            for (int i = 1; i < 15; i++) {
                m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
                m[i - 1] &= 0xffff;
            }
            m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
            int b = (int) ((m[15] >> 16) & 1);
            m[14] &= 0xffff;
            sel25519(t, m, 1 - b);
        }
        for (int i = 0; i < 16; i++) {
            o[2 * i] = (byte) (t[i] & 0xff);
            o[2 * i + 1] = (byte) (t[i] >> 8);
        }
    }

    private static boolean neq25519(long[] a, long[] b) {
        byte[] c = new byte[32];
        byte[] d = new byte[32];
        pack25519(c, a);
        pack25519(d, b);
        return !verify32(c, 0, d, 0);
    }

    private static int par25519(long[] a) {
        byte[] d = new byte[32];
        pack25519(d, a);
        return d[0] & 1;
    }

    private static void unpack25519(long[] o, byte[] n) {
        for (int i = 0; i < 16; i++) {
            o[i] = (n[2 * i] & 0xffL) + ((n[2 * i + 1] & 0xffL) << 8);
        }
        o[15] &= 0x7fff;
    }

    private static void add(long[] o, long[] a, long[] b) {
        for (int i = 0; i < 16; i++) o[i] = a[i] + b[i];
    }

    private static void sub(long[] o, long[] a, long[] b) {
        for (int i = 0; i < 16; i++) o[i] = a[i] - b[i];
    }

    private static void mul(long[] o, long[] a, long[] b) {
        long[] t = new long[31];
        for (int i = 0; i < 16; i++) {
            for (int j = 0; j < 16; j++) t[i + j] += a[i] * b[j];
        }
        for (int i = 0; i < 15; i++) t[i] += 38 * t[i + 16];
        System.arraycopy(t, 0, o, 0, 16);
        car25519(o);
        car25519(o);
    }

    private static void sq(long[] o, long[] a) {
        mul(o, a, a);
    }

    private static void inv25519(long[] o, long[] i) {
        long[] c = new long[16];
        set(c, i);
        for (int a = 253; a >= 0; a--) {
            sq(c, c);
            if (a != 2 && a != 4) mul(c, c, i);
        }
        set(o, c);
    }

    private static void pow2523(long[] o, long[] i) {
        long[] c = new long[16];
        set(c, i);
        for (int a = 250; a >= 0; a--) {
            sq(c, c);
            if (a != 1) mul(c, c, i);
        }
        set(o, c);
    }

    // ------------------------------------------------------------------
    // Group operations (extended coordinates, [X,Y,Z,T])
    // ------------------------------------------------------------------

    private static void pointAdd(long[][] p, long[][] q) {
        long[] a = gf(), b = gf(), c = gf(), d = gf(), t = gf(), e = gf(), f = gf(), g = gf(), h = gf();
        sub(a, p[1], p[0]);
        sub(t, q[1], q[0]);
        mul(a, a, t);
        add(b, p[0], p[1]);
        add(t, q[0], q[1]);
        mul(b, b, t);
        mul(c, p[3], q[3]);
        mul(c, c, D2);
        mul(d, p[2], q[2]);
        add(d, d, d);
        sub(e, b, a);
        sub(f, d, c);
        add(g, d, c);
        add(h, b, a);
        mul(p[0], e, f);
        mul(p[1], h, g);
        mul(p[2], g, f);
        mul(p[3], e, h);
    }

    private static void cswap(long[][] p, long[][] q, int b) {
        for (int i = 0; i < 4; i++) sel25519(p[i], q[i], b);
    }

    private static void pack(byte[] r, long[][] p) {
        long[] tx = gf(), ty = gf(), zi = gf();
        inv25519(zi, p[2]);
        mul(tx, p[0], zi);
        mul(ty, p[1], zi);
        pack25519(r, ty);
        r[31] ^= (byte) (par25519(tx) << 7);
    }

    private static void scalarmult(long[][] p, long[][] q, byte[] s) {
        p[0] = gf();
        p[1] = gfOne();
        p[2] = gfOne();
        p[3] = gf();
        for (int i = 255; i >= 0; i--) {
            int b = (s[i >> 3] >> (i & 7)) & 1;
            cswap(p, q, b);
            pointAdd(q, p);
            pointAdd(p, p);
            cswap(p, q, b);
        }
    }

    private static void scalarbase(long[][] p, byte[] s) {
        long[][] q = new long[4][];
        q[0] = X.clone();
        q[1] = Y.clone();
        q[2] = gfOne();
        q[3] = gf();
        mul(q[3], X, Y);
        scalarmult(p, q, s);
    }

    /** Decompresses a public key; returns -1 when the encoding is not a curve point. */
    private static int unpackneg(long[][] r, byte[] p) {
        long[] t = gf(), chk = gf(), num = gf(), den = gf(), den2 = gf(), den4 = gf(), den6 = gf();
        r[0] = gf();
        r[1] = gf();
        r[2] = gfOne();
        r[3] = gf();

        unpack25519(r[1], p);
        sq(num, r[1]);
        mul(den, num, D);
        sub(num, num, r[2]);
        add(den, r[2], den);

        sq(den2, den);
        sq(den4, den2);
        mul(den6, den4, den2);
        mul(t, den6, num);
        mul(t, t, den);

        pow2523(t, t);
        mul(t, t, num);
        mul(t, t, den);
        mul(t, t, den);
        mul(r[0], t, den);

        sq(chk, r[0]);
        mul(chk, chk, den);
        if (neq25519(chk, num)) mul(r[0], r[0], I);

        sq(chk, r[0]);
        mul(chk, chk, den);
        if (neq25519(chk, num)) return -1;

        if (par25519(r[0]) == ((p[31] & 0xff) >> 7)) sub(r[0], gf(), r[0]);

        mul(r[3], r[0], r[1]);
        return 0;
    }

    // ------------------------------------------------------------------
    // Scalar reduction and primitives
    // ------------------------------------------------------------------

    private static void reduce(byte[] r) {
        long[] x = new long[64];
        for (int i = 0; i < 64; i++) x[i] = r[i] & 0xffL;
        for (int i = 0; i < 64; i++) r[i] = 0;
        modL(r, x);
    }

    private static void modL(byte[] r, long[] x) {
        for (int i = 63; i >= 32; i--) {
            long carry = 0;
            int j;
            for (j = i - 32; j < i - 12; j++) {
                x[j] += carry - 16 * x[i] * L[j - (i - 32)];
                carry = (x[j] + 128) >> 8;
                x[j] -= carry << 8;
            }
            x[j] += carry;
            x[i] = 0;
        }
        long carry = 0;
        for (int j = 0; j < 32; j++) {
            x[j] += carry - (x[31] >> 4) * L[j];
            carry = x[j] >> 8;
            x[j] &= 255;
        }
        for (int j = 0; j < 32; j++) x[j] -= carry * L[j];
        for (int i = 0; i < 32; i++) {
            x[i + 1] += x[i] >> 8;
            r[i] = (byte) (x[i] & 255);
        }
    }

    private static byte[] sha512(byte[] input) {
        try {
            return MessageDigest.getInstance("SHA-512").digest(input);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-512 unavailable", e); // every JVM/Android ships it
        }
    }

    /** Constant-time comparison of 32-byte slices. */
    private static boolean verify32(byte[] x, int xi, byte[] y, int yi) {
        int d = 0;
        for (int i = 0; i < 32; i++) d |= (x[xi + i] ^ y[yi + i]);
        return d == 0;
    }
}
