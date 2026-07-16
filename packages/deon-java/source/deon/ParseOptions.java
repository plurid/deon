package deon;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The capabilities and surroundings a caller decides. Nothing is granted that was not asked for: the
 * filesystem and the network both default to denied, and the environment read by {@code #$NAME} defaults
 * to empty and is never filled in from the process environment — a library that read the ambient
 * environment would make a document mean one thing on one machine and another on the next.
 */
public final class ParseOptions {
    public String sourceName = "";
    public String filebase = "";

    public Map<String, String> resources = Map.of();       // consulted before any loader
    public Map<String, String> absolutePaths = Map.of();   // logical target -> host path
    public Map<String, String> environment = Map.of();     // what #$NAME reads; empty by default
    public Map<String, String> authorization = Map.of();   // bearer token per lowercase hostname
    public String token = "";                              // the credential parseLink fetches with

    public boolean allowFilesystem = false;
    public boolean allowNetwork = false;

    public boolean cache = false;
    public int cacheDuration = 0;                          // milliseconds; 0 means the default (one hour)
    public String cacheDirectory = "";                     // empty means ~/.deon-cache

    public List<String> datasignFiles = List.of();
    public Map<String, String> datasignMap = Map.of();

    /** The defaults above. Explicit because declaring the copy constructor would otherwise remove it. */
    public ParseOptions() {
    }

    /**
     * A deep copy of another options. A parse settles its own source name, base, and grants on this copy
     * and never writes them back into the instance the caller still holds — so an object reused for a
     * later parse the caller meant to sandbox does not silently inherit a filesystem grant (specification
     * 9). The collections are copied rather than shared: a later mutation of one is invisible to the other.
     */
    public ParseOptions(ParseOptions other) {
        this.sourceName = other.sourceName;
        this.filebase = other.filebase;
        this.resources = new LinkedHashMap<>(other.resources);
        this.absolutePaths = new LinkedHashMap<>(other.absolutePaths);
        this.environment = new LinkedHashMap<>(other.environment);
        this.authorization = new LinkedHashMap<>(other.authorization);
        this.token = other.token;
        this.allowFilesystem = other.allowFilesystem;
        this.allowNetwork = other.allowNetwork;
        this.cache = other.cache;
        this.cacheDuration = other.cacheDuration;
        this.cacheDirectory = other.cacheDirectory;
        this.datasignFiles = new ArrayList<>(other.datasignFiles);
        this.datasignMap = new LinkedHashMap<>(other.datasignMap);
    }

    String sourceName() {
        return sourceName == null || sourceName.isEmpty() ? "<memory>" : sourceName;
    }
}
