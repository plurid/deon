package deon;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

/**
 * Reading a resource over HTTP once the network has been granted (specification 9). The stdlib client
 * carries this — no third-party dependency, and TLS comes with it. An import asks for Deon or JSON; an
 * injection asks for anything; a link asks for Deon and nothing else. A non-2xx status is
 * DEON_RESOURCE_IO — it was allowed and it failed, which is a different thing from never having been
 * allowed. An empty token sends no header, because {@code Bearer } is a credential-shaped nothing.
 */
final class Network {
    private static final HttpClient CLIENT = HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    static String httpGet(String target, String kind, String token, Span span) {
        String accept = switch (kind) {
            case "import" -> "text/plain,application/json,application/deon";
            case "link" -> "application/deon";
            default -> "*/*";
        };

        HttpRequest.Builder builder;
        try {
            builder = HttpRequest.newBuilder(URI.create(target)).GET().header("Accept", accept);
        } catch (IllegalArgumentException e) {
            throw new DeonException(Code.RESOURCE_IO, "Unable to reach resource '" + target + "'.", span);
        }
        if (token != null && !token.isEmpty()) {
            builder.header("Authorization", "Bearer " + token);
        }

        HttpResponse<byte[]> response;
        try {
            response = CLIENT.send(builder.build(), HttpResponse.BodyHandlers.ofByteArray());
        } catch (Exception e) {
            throw new DeonException(Code.RESOURCE_IO, "Unable to reach resource '" + target + "'.", span);
        }

        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new DeonException(Code.RESOURCE_IO, "Resource '" + target + "' returned a non-success status.", span);
        }
        byte[] body = response.body();
        if (!Interpreter.isValidUtf8(body)) {
            throw new DeonException(Code.RESOURCE_FORMAT, "The resource '" + target + "' is not valid UTF-8.", span);
        }
        return new String(body, StandardCharsets.UTF_8);
    }
}
