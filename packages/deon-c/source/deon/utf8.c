#include "internal.h"

/* UTF-8, decoded to code points so the parser can count columns in code points and offsets in bytes —
 * the two numbers a diagnostic needs, and the two that are so easily confused. */

uint32_t utf8_decode(const char *s, const char *end, int *width) {
    const unsigned char *p = (const unsigned char *)s;
    if (p >= (const unsigned char *)end) {
        *width = 1;
        return 0xFFFD;
    }
    unsigned char c = p[0];
    if (c < 0x80) {
        *width = 1;
        return c;
    }
    int need;
    uint32_t rune;
    if ((c & 0xE0) == 0xC0) { need = 1; rune = c & 0x1F; }
    else if ((c & 0xF0) == 0xE0) { need = 2; rune = c & 0x0F; }
    else if ((c & 0xF8) == 0xF0) { need = 3; rune = c & 0x07; }
    else { *width = 1; return 0xFFFD; }

    for (int i = 1; i <= need; i++) {
        if (p + i >= (const unsigned char *)end || (p[i] & 0xC0) != 0x80) {
            *width = 1;
            return 0xFFFD;
        }
        rune = (rune << 6) | (p[i] & 0x3F);
    }
    /* reject overlong / out of range */
    if ((need == 1 && rune < 0x80) ||
        (need == 2 && rune < 0x800) ||
        (need == 3 && rune < 0x10000) ||
        rune > 0x10FFFF ||
        (rune >= 0xD800 && rune <= 0xDFFF)) {
        *width = 1;
        return 0xFFFD;
    }
    *width = need + 1;
    return rune;
}

bool is_control_rune(uint32_t cp) {
    if (cp <= 0x1F) return cp != 0x09 && cp != 0x0A && cp != 0x0D; /* C0 except tab, LF, CR */
    if (cp == 0x7F) return true;                                   /* DEL */
    if (cp >= 0x80 && cp <= 0x9F) return true;                     /* C1 */
    return false;
}

int utf8_width(uint32_t rune) {
    if (rune < 0x80) return 1;
    if (rune < 0x800) return 2;
    if (rune < 0x10000) return 3;
    return 4;
}

void utf8_encode(uint32_t rune, sb *b) {
    if (rune < 0x80) {
        sb_putc(b, (char)rune);
    } else if (rune < 0x800) {
        sb_putc(b, (char)(0xC0 | (rune >> 6)));
        sb_putc(b, (char)(0x80 | (rune & 0x3F)));
    } else if (rune < 0x10000) {
        sb_putc(b, (char)(0xE0 | (rune >> 12)));
        sb_putc(b, (char)(0x80 | ((rune >> 6) & 0x3F)));
        sb_putc(b, (char)(0x80 | (rune & 0x3F)));
    } else {
        sb_putc(b, (char)(0xF0 | (rune >> 18)));
        sb_putc(b, (char)(0x80 | ((rune >> 12) & 0x3F)));
        sb_putc(b, (char)(0x80 | ((rune >> 6) & 0x3F)));
        sb_putc(b, (char)(0x80 | (rune & 0x3F)));
    }
}

bool utf8_valid(const char *s, size_t len) {
    const unsigned char *p = (const unsigned char *)s;
    const unsigned char *end = p + len;
    while (p < end) {
        unsigned char c = p[0];
        int need;
        uint32_t rune;
        if (c < 0x80) { p += 1; continue; }
        else if ((c & 0xE0) == 0xC0) { need = 1; rune = c & 0x1F; }
        else if ((c & 0xF0) == 0xE0) { need = 2; rune = c & 0x0F; }
        else if ((c & 0xF8) == 0xF0) { need = 3; rune = c & 0x07; }
        else return false;

        for (int i = 1; i <= need; i++) {
            if (p + i >= end || (p[i] & 0xC0) != 0x80) return false;
            rune = (rune << 6) | (p[i] & 0x3F);
        }
        if ((need == 1 && rune < 0x80) ||
            (need == 2 && rune < 0x800) ||
            (need == 3 && rune < 0x10000) ||
            rune > 0x10FFFF ||
            (rune >= 0xD800 && rune <= 0xDFFF)) {
            return false;
        }
        p += need + 1;
    }
    return true;
}
