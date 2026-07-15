package deon;

import java.util.List;

/**
 * One thing a document declares, and what it would demand of a caller. The parameters are not declared
 * anywhere — they are the interpolation names an entity carries, which is a rule of the language
 * (specification 10) rather than a convention.
 */
public record Entity(String name, List<String> parameters, String kind) {
}
