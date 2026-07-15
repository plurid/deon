package deon

import (
	"io"
	"net/http"
)

// httpGet reads a resource over HTTP once the network has been granted (specification 9). An import
// asks for Deon or JSON; an injection asks for anything. A non-2xx status is DEON_RESOURCE_IO — it was
// allowed and it failed, which is a different thing from never having been allowed. An empty token
// sends no header, because `Bearer ` is a credential-shaped nothing.
func httpGet(target, kind, token string, span Span) string {
	request, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		fail(ResourceIO, "Unable to reach resource '"+target+"'.", span)
	}

	if kind == "import" {
		request.Header.Set("Accept", "text/plain,application/json,application/deon")
	} else {
		request.Header.Set("Accept", "*/*")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		fail(ResourceIO, "Unable to reach resource '"+target+"'.", span)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fail(ResourceIO, "Resource '"+target+"' returned a non-success status.", span)
	}

	body, err := io.ReadAll(response.Body)
	if err != nil {
		fail(ResourceIO, "Unable to read resource '"+target+"'.", span)
	}
	if !isValidUTF8(string(body)) {
		fail(ResourceFormat, "The resource '"+target+"' is not valid UTF-8.", span)
	}
	return string(body)
}
