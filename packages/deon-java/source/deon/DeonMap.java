package deon;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * An ordered map, because a Deon map's write order is part of it (specification 2) and Java's own maps
 * either forget order or keep the wrong one. A rewritten key moves to its final write position
 * (specification 5): the built-in {@code LinkedHashMap} keeps a re-put key in its original slot, so
 * {@link #set} removes it first, which re-appends it at the end.
 *
 * A Deon value is one of exactly three things — a {@link String}, a {@code List<Object>}, or a {@code
 * DeonMap}. The typer (specification 14) additionally yields {@link Boolean} and {@link Double}, which
 * are a view of a value rather than a value.
 */
public final class DeonMap {
    private final LinkedHashMap<String, Object> entries = new LinkedHashMap<>();

    public void set(String key, Object value) {
        entries.remove(key); // remove-then-put moves the key to its final write position
        entries.put(key, value);
    }

    public Object get(String key) {
        return entries.get(key);
    }

    public boolean has(String key) {
        return entries.containsKey(key);
    }

    public int size() {
        return entries.size();
    }

    public List<String> keys() {
        return new ArrayList<>(entries.keySet());
    }

    /** Equality ignores order: it is presentation, not identity (specification 2). */
    @Override
    public boolean equals(Object other) {
        if (!(other instanceof DeonMap that)) {
            return false;
        }
        if (entries.size() != that.entries.size()) {
            return false;
        }
        for (Map.Entry<String, Object> entry : entries.entrySet()) {
            if (!that.entries.containsKey(entry.getKey())) {
                return false;
            }
            if (!Values.equal(entry.getValue(), that.entries.get(entry.getKey()))) {
                return false;
            }
        }
        return true;
    }

    @Override
    public int hashCode() {
        int hash = 0;
        for (Map.Entry<String, Object> entry : entries.entrySet()) {
            hash += entry.getKey().hashCode(); // order-independent, to match equals
        }
        return hash;
    }
}
