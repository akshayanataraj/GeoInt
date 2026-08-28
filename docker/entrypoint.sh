#!/bin/sh
# Start the optional Python sidecar in the background, then run nginx in the
# foreground as PID 1. If nginx exits the container stops; if the sidecar dies
# the static app keeps serving (conversion/Whitebox features report
# unavailable until the container is restarted).
set -e

# Per-container shared secret the sidecar requires on every request (see the
# require_sidecar_token middleware). nginx forwards it on /sidecar/ proxied
# requests and uvicorn enforces it, so the loopback sidecar cannot be driven by
# anything other than the trusted proxy even if its port is ever exposed.
# Honour an operator-provided value; otherwise mint a random one.
GEOLIBRE_SIDECAR_TOKEN="${GEOLIBRE_SIDECAR_TOKEN:-$(python -c 'import secrets; print(secrets.token_hex(16))')}"
export GEOLIBRE_SIDECAR_TOKEN

# The token is embedded in a double-quoted nginx header value, so reject any
# character that could break the config (quotes, backslashes, whitespace, &).
# The auto-generated hex always passes; an operator override must be URL-safe.
case "$GEOLIBRE_SIDECAR_TOKEN" in
  "" | *[!A-Za-z0-9._-]*)
    echo "GEOLIBRE_SIDECAR_TOKEN must be non-empty and contain only [A-Za-z0-9._-]" >&2
    exit 1
    ;;
esac

# Optional AI proxy. All three values are required together so merely setting a
# model never embeds or enables ai.geolibre.app. GEOLIBRE_AI_URL is deliberately
# restricted to the same-origin /ai route; the remote Worker URL and instance
# token remain server-side in nginx.
AI_PROXY_CONF=/etc/nginx/geolibre-ai-proxy.conf
if [ -n "${GEOLIBRE_AI_URL:-}" ] || [ -n "${GEOLIBRE_AI_PROXY_URL:-}" ] || [ -n "${GEOLIBRE_AI_PROXY_TOKEN:-}" ]; then
  if [ -z "${GEOLIBRE_AI_URL:-}" ] || [ -z "${GEOLIBRE_AI_PROXY_URL:-}" ] || [ -z "${GEOLIBRE_AI_PROXY_TOKEN:-}" ]; then
    echo "ERROR: GEOLIBRE_AI_URL, GEOLIBRE_AI_PROXY_URL, and GEOLIBRE_AI_PROXY_TOKEN must be set together." >&2
    exit 1
  fi
  case "$GEOLIBRE_AI_URL" in
    /ai|/ai/) GEOLIBRE_AI_URL=/ai ;;
    *)
      echo "ERROR: Docker GEOLIBRE_AI_URL must be the same-origin path /ai." >&2
      exit 1
      ;;
  esac
  case "$GEOLIBRE_AI_PROXY_TOKEN" in
    "" | *[!A-Za-z0-9._-]*)
      echo "ERROR: GEOLIBRE_AI_PROXY_TOKEN must contain only [A-Za-z0-9._-]." >&2
      exit 1
      ;;
  esac
  export GEOLIBRE_AI_URL
  export GEOLIBRE_AI_MODEL="${GEOLIBRE_AI_MODEL:-openai/gpt-5.6-luna}"
  export GEOLIBRE_AI_PROXY_URL GEOLIBRE_AI_PROXY_TOKEN

  python -c '
import ipaddress
import os
from urllib.parse import urlsplit

upstream = os.environ["GEOLIBRE_AI_PROXY_URL"].rstrip("/")
parsed = urlsplit(upstream)
if (
    parsed.scheme != "https"
    or not parsed.hostname
    or parsed.username
    or parsed.password
    or parsed.path not in ("", "/")
    or parsed.query
    or parsed.fragment
):
    raise SystemExit(
        "ERROR: GEOLIBRE_AI_PROXY_URL must be an HTTPS origin without credentials, path, query, or fragment."
    )

host = parsed.hostname
# urlsplit strips the brackets from an IPv6 literal; Host and SNI need them back
# or the generated header is ambiguous and nginx rejects the config.
authority = f"[{host}]" if ":" in host else host
host_header = authority if parsed.port is None else f"{authority}:{parsed.port}"

# Behind a fronting TLS proxy $remote_addr is that proxy, which would collapse
# every user into a single rate-limit bucket upstream. Trust X-Forwarded-For
# only from explicitly listed proxy CIDRs; unset means trust nobody. Each entry
# is parsed as a network before it reaches the config, so nothing else can be
# smuggled into the generated directives.
trusted = []
for entry in os.environ.get("GEOLIBRE_TRUSTED_PROXIES", "").split(","):
    entry = entry.strip()
    if not entry:
        continue
    try:
        trusted.append(str(ipaddress.ip_network(entry, strict=False)))
    except ValueError:
        raise SystemExit(
            f"ERROR: GEOLIBRE_TRUSTED_PROXIES entry {entry!r} is not an IP address or CIDR."
        )
real_ip = "".join(f"    set_real_ip_from {entry};\n" for entry in trusted)
if real_ip:
    real_ip += "    real_ip_header X-Forwarded-For;\n    real_ip_recursive on;\n"

token = os.environ["GEOLIBRE_AI_PROXY_TOKEN"]
config = f"""
location /ai/ {{
{real_ip}
    proxy_pass {upstream}/;
    proxy_http_version 1.1;
    proxy_ssl_server_name on;
    proxy_ssl_name {host};
    proxy_set_header Host {host_header};
    proxy_set_header Authorization "";
    proxy_set_header Origin "";
    proxy_set_header X-GeoLibre-Instance-Token "{token}";
    proxy_set_header X-GeoLibre-Client-IP $remote_addr;
    proxy_set_header X-Forwarded-For "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
}}
"""
open("/etc/nginx/geolibre-ai-proxy.conf", "w").write(config)
'
  chmod 640 "$AI_PROXY_CONF"
  echo "Authenticated AI proxy enabled at /ai."
else
  printf '# AI proxy disabled (GEOLIBRE_AI_URL not set).\n' > "$AI_PROXY_CONF"
fi

# Media (News/Social) backend proxy for the analyst intelligence console.
# Unlike the AI proxy above this is not opt-in -- the console's own panels
# depend on it -- so it always writes a location block, defaulting to the
# currently-known dev deployment. Same reasoning as /sidecar/: the browser
# calls the same-origin /media route and never holds the bearer token: nginx
# injects it server-side. This also sidesteps that deployment's own strict
# CORS allowlist, which rejects every origin this app could plausibly be
# served from (confirmed against the live host) -- a server-to-server proxy
# request carries no browser Origin at all once cleared below, so the
# backend's CORS check (a browser-only mechanism) never enters into it.
GEOLIBRE_MEDIA_API_URL="${GEOLIBRE_MEDIA_API_URL:-http://10.10.180.48:8302}"
GEOLIBRE_MEDIA_API_TOKEN="${GEOLIBRE_MEDIA_API_TOKEN:-revamp-local-dev-token-8302}"
export GEOLIBRE_MEDIA_API_URL GEOLIBRE_MEDIA_API_TOKEN

case "$GEOLIBRE_MEDIA_API_TOKEN" in
  "" | *[!A-Za-z0-9._-]*)
    echo "ERROR: GEOLIBRE_MEDIA_API_TOKEN must be non-empty and contain only [A-Za-z0-9._-]." >&2
    exit 1
    ;;
esac

python -c '
import os
from urllib.parse import urlsplit

upstream = os.environ["GEOLIBRE_MEDIA_API_URL"].rstrip("/")
parsed = urlsplit(upstream)
if (
    parsed.scheme not in ("http", "https")
    or not parsed.hostname
    or parsed.username
    or parsed.password
    or parsed.path not in ("", "/")
    or parsed.query
    or parsed.fragment
):
    raise SystemExit(
        "ERROR: GEOLIBRE_MEDIA_API_URL must be an http(s) origin without credentials, path, query, or fragment."
    )

host = parsed.hostname
authority = f"[{host}]" if ":" in host else host
host_header = authority if parsed.port is None else f"{authority}:{parsed.port}"
tls = "\n".join([f"    proxy_ssl_server_name on;", f"    proxy_ssl_name {host};"]) if parsed.scheme == "https" else ""

token = os.environ["GEOLIBRE_MEDIA_API_TOKEN"]
config = f"""
location /media/ {{
    proxy_pass {upstream}/api/v1/media/;
    proxy_http_version 1.1;
{tls}
    proxy_set_header Host {host_header};
    proxy_set_header Authorization "Bearer {token}";
    proxy_set_header Origin "";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 5s;
    # News/Social chat calls are LLM-bound. The service'"'"'s own frontend guide
    # suggests 120s as a starting point, but a real measured chat call against
    # this deployment took ~180s -- generous headroom over that, matched by
    # REQUEST_TIMEOUT_MS on the client side (client.ts), since either one
    # alone would still cut the request off.
    proxy_read_timeout 600s;
}}
"""
open("/etc/nginx/geolibre-media-proxy.conf", "w").write(config)
'
chmod 640 /etc/nginx/geolibre-media-proxy.conf
echo "Media backend proxy enabled at /media/ -> $GEOLIBRE_MEDIA_API_URL/api/v1/media/"

# Runtime config the app reads at load (index.html pulls it in before the
# bundle). Written on every boot, after the optional blocks above have exported
# their values, so toggling any of these env vars across restarts takes effect.
# Python JSON-encodes the values, so nothing an operator passes can break out of
# the generated script.
python -c '
import json
import os
import re
import base64
from urllib.parse import urlsplit

deployment = {}
# Values published as bare globals rather than inside __GEOLIBRE_DEPLOYMENT_ENV__.
# That object is a GeoLibre convention (see deployment-env.ts); a plugin from
# outside this repo answers to its own contract, and some of them read a plain
# global. Keys here are literals from this file, never operator input, so they
# cannot inject anything into the generated script.
browser_globals = {}
if os.environ.get("GEOLIBRE_AI_URL"):
    deployment["VITE_GEOLIBRE_AI_URL"] = os.environ["GEOLIBRE_AI_URL"]
    deployment["VITE_GEOLIBRE_AI_MODEL"] = os.environ["GEOLIBRE_AI_MODEL"]

# Origins allowed to drive a framed app over the embed postMessage API. Unset
# means the API stays off, so a public deployment can never be driven by the
# page that frames it. "*" allows any origin: private networks only.
origins = []
for entry in os.environ.get("GEOLIBRE_EMBED_ORIGINS", "").replace(",", " ").split():
    if entry == "*":
        origins.append(entry)
        continue
    parsed = urlsplit(entry)
    # postMessage can only be scoped to an origin, so a path/query/fragment on an
    # otherwise valid URL is dropped rather than rejected (matching how the app
    # parses the same value). Credentials and other schemes are a mistake worth
    # failing the boot for, since they can never match a real host.
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.netloc
        or parsed.username
        or parsed.password
    ):
        raise SystemExit(
            f"ERROR: GEOLIBRE_EMBED_ORIGINS entry {entry!r} must be an http(s) "
            "origin such as https://portal.example.com."
        )
    origins.append(f"{parsed.scheme}://{parsed.netloc}")
if origins:
    deployment["VITE_GEOLIBRE_EMBED_ORIGINS"] = ",".join(origins)


def service_url(name, value, schemes, loopback_schemes, loopback_hosts):
    """Validate a self-hosted service URL, or exit with an explanation.

    Every caller sends a credential to the value it is given -- the share and
    collab URLs carry a Bearer token, and a news proxy fronting a Tavily key is
    only worth pointing at over TLS whatever it asks for -- so a plaintext scheme
    is only allowed on loopback (development). The app applies the same rule and
    *refuses* a value it rejects rather than falling back to the public hosted
    service — so a value that reaches the app unvalidated becomes a silently
    disabled feature. Failing the boot instead puts the error where an operator
    will actually see it.
    """
    parsed = urlsplit(value)
    # Both checks below run before the loopback shortcut, so their guarantees hold
    # for every accepted value. That ordering is load-bearing: urlsplit() parses
    # ws://localhost:8080"; ... with hostname "localhost", which would match the
    # loopback allowlist while netloc still carried the rest.
    #
    # Credentials: both values are echoed to stdout further down, so a credentialed
    # URL would also land in the container logs.
    if parsed.username or parsed.password:
        raise SystemExit(f"ERROR: {name} must not embed credentials.")
    # Character set: netloc is substituted unescaped into the double-quoted CSP
    # add_header value in nginx.conf.template, so anything outside a hostname,
    # port, or IPv6 literal could break out of that string and inject nginx
    # directives. urlsplit() puts everything up to the next /, ? or # into netloc,
    # quotes and semicolons included. Same discipline as GEOLIBRE_TRUSTED_PROXIES
    # (parsed through ipaddress) and GEOLIBRE_AI_PROXY_URL (no path/query/fragment).
    if re.search(r"[^A-Za-z0-9.\-:\[\]]", parsed.netloc):
        raise SystemExit(
            f"ERROR: {name} host may contain only letters, digits, dots, hyphens, "
            f"colons, and brackets, not {parsed.netloc!r}."
        )
    if parsed.scheme in loopback_schemes and parsed.hostname in loopback_hosts:
        return value
    if parsed.scheme not in schemes or not parsed.netloc:
        # Joined outside the f-string, and with double quotes. This whole program
        # is one single-quoted `python -c` argument, so a literal apostrophe here
        # would close that argument in the shell; Python would then receive
        # `{/.join(...)}` and die of a SyntaxError. Note -c compiles as a unit, so
        # that failure hits every deployment at boot, not just an invalid URL.
        allowed_hosts = "/".join(loopback_hosts)
        raise SystemExit(
            f"ERROR: {name} must be a {schemes[0]}:// URL "
            f"(or {loopback_schemes[0]}:// on {allowed_hosts}), not {value!r}."
        )
    return value


# The externally loaded NASA OPERA plugin can share the authenticated /ai route
# when the managed Worker exposes /tavily. Operators using a separate news
# Worker can override this with its public HTTPS URL. Only the endpoint reaches
# the browser; the Tavily key remains a Worker secret.
#
# Either way the published value is the proxy *base* the plugin appends its own
# /tavily path to, which is why the same-origin fallback is "/ai" and not
# "/ai/tavily". That fallback needs no service_url() check: the shell block above
# already pins GEOLIBRE_AI_URL to exactly "/ai" and exits otherwise, and
# service_url() would in fact reject a bare path, having no scheme or netloc.
news_url = os.environ.get("GEOLIBRE_NASA_OPERA_NEWS_PROXY_ENDPOINT", "").strip()
if news_url:
    # rstrip the trailing slash the way GEOLIBRE_AI_PROXY_URL is handled above. A
    # base ending in "/" would become ".../tavily" with a doubled slash under a
    # plain string join, and the plugin doing that join is out of this repo, so
    # this is the only place that can rule it out. Stripping before service_url()
    # keeps a slashes-only value an error rather than silently unsetting it.
    news_endpoint = service_url(
        "GEOLIBRE_NASA_OPERA_NEWS_PROXY_ENDPOINT",
        news_url.rstrip("/"),
        ("https",),
        ("http",),
        ("localhost", "127.0.0.1", "::1"),
    )
elif os.environ.get("GEOLIBRE_AI_URL"):
    news_endpoint = os.environ["GEOLIBRE_AI_URL"]
else:
    news_endpoint = ""
if news_endpoint:
    # A TOP-LEVEL global, not a key in the deployment env object, because the
    # reader is a plugin loaded from outside this repo and its contract is its
    # own. geolibre-nasa-opera resolves this in src/lib/opera/news.ts as
    # globalThis[GEOLIBRE_NASA_OPERA_NEWS_PROXY_ENDPOINT], falling back to its own
    # build-time VITE_NEWS_PROXY_ENDPOINT; across the whole history of that repo it has
    # never read window.__GEOLIBRE_DEPLOYMENT_ENV__ for this value. Publishing it
    # only inside that object, as this block did before, therefore configured
    # nothing: the plugin looked for a global that was not there, found nothing,
    # and reported the news proxy as unconfigured.
    #
    # No apostrophes below: this whole program is one single-quoted `python -c`
    # argument, and a literal apostrophe in a comment ends it just as surely as one
    # in code (see the allowed_hosts note in service_url above).
    browser_globals["GEOLIBRE_NASA_OPERA_NEWS_PROXY_ENDPOINT"] = news_endpoint


# Project sharing server. Unset means the public hosted service; "off" removes
# Share and the Project Gallery from the UI entirely.
share_url = os.environ.get("GEOLIBRE_SHARE_URL", "").strip()
if share_url:
    if share_url.lower() == "off":
        deployment["VITE_GEOLIBRE_SHARE_URL"] = "off"
    else:
        deployment["VITE_GEOLIBRE_SHARE_URL"] = service_url(
            "GEOLIBRE_SHARE_URL", share_url, ("https",), ("http",), ("localhost", "127.0.0.1")
        )

with open("/usr/share/nginx/html/geolibre-runtime-config.js", "w") as output:
    output.write("window.__GEOLIBRE_DEPLOYMENT_ENV__ = ")
    json.dump(deployment, output, separators=(",", ":"))
    output.write(";\n")
    for global_name, global_value in browser_globals.items():
        output.write("window." + global_name + " = ")
        json.dump(global_value, output)
        output.write(";\n")
'

# Strip surrounding whitespace exactly as the Python block above does, so the boot
# log reports the value that actually landed in the runtime config rather than the
# raw variable (`" off "` is disabled there, and should read as disabled here too).
trim() {
  printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

if [ -n "$(trim "${GEOLIBRE_SHARE_URL:-}")" ]; then
  SHARE_URL_LOG=$(trim "$GEOLIBRE_SHARE_URL")
  # Case-insensitive to match the Python validator above and the client's
  # resolveShareHost, both of which lowercase before comparing to "off".
  case "$SHARE_URL_LOG" in
    [oO][fF][fF]) echo "Project sharing disabled (GEOLIBRE_SHARE_URL=off)." ;;
    *) echo "Project sharing server: $SHARE_URL_LOG" ;;
  esac
fi

if [ -n "$(trim "${GEOLIBRE_NASA_OPERA_NEWS_PROXY_ENDPOINT:-}")" ]; then
  echo "NASA OPERA news proxy: $(trim "$GEOLIBRE_NASA_OPERA_NEWS_PROXY_ENDPOINT")"
elif [ -n "${GEOLIBRE_AI_URL:-}" ]; then
  # "routed through", not "enabled": whether search actually works depends on the
  # Worker holding TAVILY_API_KEY, which this container has no way to see. Without
  # it the route answers 503 to every request.
  echo "NASA OPERA news search routed through $GEOLIBRE_AI_URL (requires TAVILY_API_KEY on the Worker)."
fi

if [ -n "${GEOLIBRE_EMBED_ORIGINS:-}" ]; then
  echo "Embed postMessage API enabled for: $GEOLIBRE_EMBED_ORIGINS"
fi

# Render the nginx config from the immutable image template on every boot. The
# template is never mutated, so a container *restart* (which re-runs this script
# with a freshly generated token but keeps the writable layer) always writes a
# config whose forwarded token matches the token exported to uvicorn above.
# Python's str.replace handles the token literally (no shell/sed metacharacter
# surprises).
python -c '
import os
import re
import base64
from urllib.parse import urlsplit

token = os.environ["GEOLIBRE_SIDECAR_TOKEN"]

# A self-hosted relay has to be allowed in connect-src or the browser blocks its
# WebSocket: the directive has a bare "https:" (so any share host works) but no
# bare "wss:". Only the origin is inserted -- CSP source expressions do not take a
# path, and the value was already validated above.
collab = os.environ.get("GEOLIBRE_COLLAB_URL", "").strip()
# Carries its own leading space so the header is byte-identical to the template
# when no relay is configured.
collab_src = ""
if collab:
    parsed = urlsplit(collab)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    # Re-checked here rather than trusting service_url(): this string goes into a
    # quoted nginx directive, so it must be a plain origin or nothing at all.
    if not re.fullmatch(r"[A-Za-z]+://[A-Za-z0-9.\-:\[\]]+", origin):
        raise SystemExit(f"ERROR: GEOLIBRE_COLLAB_URL is not a plain origin: {collab!r}.")
    collab_src = f" {origin}"

# The AI Assistant "Custom (OpenAI-compatible)" provider is called directly
# from the browser (see docs/user-guide/ai-assistant.md), so a self-hosted
# endpoint with no TLS in front -- the common case for a LAN inference server --
# needs its exact origin added to connect-src or the browser blocks the fetch.
# Unlike GEOLIBRE_COLLAB_URL this accepts http or https, since that is the
# realistic scheme for such a server.
assistant_src = ""
assistant_origin = os.environ.get("GEOLIBRE_ASSISTANT_ALLOWED_ORIGIN", "").strip()
if assistant_origin:
    parsed = urlsplit(assistant_origin)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise SystemExit(
            f"ERROR: GEOLIBRE_ASSISTANT_ALLOWED_ORIGIN must be an http(s) origin: {assistant_origin!r}."
        )
    if not re.fullmatch(r"[A-Za-z]+://[A-Za-z0-9.\-:\[\]]+", origin):
        raise SystemExit(
            f"ERROR: GEOLIBRE_ASSISTANT_ALLOWED_ORIGIN is not a plain origin: {assistant_origin!r}."
        )
    assistant_src = f" {origin}"

# Clerk loads its browser SDK from the Frontend API hostname encoded in the
# publishable key. Add only that exact hostname to script-src. The remaining
# documented Clerk requirements are fixed origins in the nginx template.
#
# The runtime-config block above already decoded and validated this same key
# (`set -e` means we never get here if it rejected one), but the decode is
# repeated with its own try/except rather than relying on that ordering: this is
# a separate `python -c` process, so an edit that reorders, extracts, or drops
# the earlier block would otherwise turn an invalid key into a raw traceback
# instead of the clean ERROR message.
clerk_src = ""
clerk_frame_src = ""
clerk_key = os.environ.get("GEOLIBRE_CLERK_PUBLISHABLE_KEY", "").strip()
if clerk_key:
    if not clerk_key.startswith(("pk_test_", "pk_live_")):
        raise SystemExit(
            "ERROR: GEOLIBRE_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key (pk_test_... or pk_live_...)."
        )
    try:
        encoded = clerk_key.split("_", 2)[2]
        encoded += "=" * (-len(encoded) % 4)
        clerk_fapi = base64.b64decode(encoded, altchars="-_", validate=True).decode()
    except (IndexError, ValueError, UnicodeDecodeError) as error:
        raise SystemExit("ERROR: GEOLIBRE_CLERK_PUBLISHABLE_KEY is invalid.") from error
    if not clerk_fapi.endswith("$"):
        raise SystemExit("ERROR: GEOLIBRE_CLERK_PUBLISHABLE_KEY is invalid.")
    clerk_fapi = clerk_fapi[:-1]
    if not re.fullmatch(r"[A-Za-z0-9.-]+", clerk_fapi) or "." not in clerk_fapi:
        raise SystemExit("ERROR: GEOLIBRE_CLERK_PUBLISHABLE_KEY contains an invalid Frontend API host.")
    clerk_src = f" https://{clerk_fapi} https://challenges.cloudflare.com https://*.protect.clerk.com"
    clerk_frame_src = " https://challenges.cloudflare.com https://*.protect.clerk.com"

# Auth0 needs no script-src entry -- its SDK is bundled into the app -- and its
# token endpoint is already covered by the bare `https:` in connect-src. What it
# does need is frame-src for the hidden silent-authentication iframe the SDK
# opens against the tenant to restore a session. Validated independently of the
# runtime-config block above for the same reason the Clerk decode is: this is a
# separate `python -c` process, so an edit that reorders or drops that block must
# not turn a bad value into a raw traceback here.
auth0_frame_src = ""
auth0_domain = os.environ.get("GEOLIBRE_AUTH0_DOMAIN", "").strip()
if auth0_domain:
    auth0_host = re.sub(r"^https?://", "", auth0_domain, flags=re.IGNORECASE).split("/")[0].lower()
    if not re.fullmatch(r"[a-z0-9.-]+", auth0_host) or "." not in auth0_host:
        raise SystemExit(
            "ERROR: GEOLIBRE_AUTH0_DOMAIN must be a tenant hostname such as example.us.auth0.com."
        )
    auth0_frame_src = f" https://{auth0_host}"

src = open("/etc/nginx/nginx.conf.template").read()
open("/etc/nginx/conf.d/default.conf", "w").write(
    src.replace("__GEOLIBRE_SIDECAR_TOKEN__", token).replace(
        "__GEOLIBRE_COLLAB_CONNECT_SRC__", collab_src
    ).replace(
        "__GEOLIBRE_ASSISTANT_CONNECT_SRC__", assistant_src
    ).replace(
        "__GEOLIBRE_CLERK_SCRIPT_SRC__", clerk_src
    ).replace(
        "__GEOLIBRE_CLERK_FRAME_SRC__", clerk_frame_src
    ).replace(
        "__GEOLIBRE_AUTH0_FRAME_SRC__", auth0_frame_src
    )
)
'

AUTH_CONF=/etc/nginx/geolibre-auth.conf
HTPASSWD=/etc/nginx/.htpasswd

# Optional HTTP Basic Auth: when both GEOLIBRE_AUTH_USER and
# GEOLIBRE_AUTH_PASSWORD are set, protect the whole server (app + /sidecar
# proxy) behind a single credential. The snippet and htpasswd are rewritten on
# every start so toggling the env vars across restarts behaves as expected.
# /healthz is exempted in nginx.conf so the container HEALTHCHECK keeps
# passing. Basic Auth is cleartext without TLS; front the container with an
# HTTPS proxy on untrusted networks.
if [ -n "${GEOLIBRE_AUTH_USER:-}" ] || [ -n "${GEOLIBRE_AUTH_PASSWORD:-}" ]; then
  if [ -z "${GEOLIBRE_AUTH_USER:-}" ] || [ -z "${GEOLIBRE_AUTH_PASSWORD:-}" ]; then
    echo "ERROR: GEOLIBRE_AUTH_USER and GEOLIBRE_AUTH_PASSWORD must be set together." >&2
    exit 1
  fi
  case "$GEOLIBRE_AUTH_USER" in
    *:*)
      echo "ERROR: GEOLIBRE_AUTH_USER must not contain ':' (htpasswd field separator)." >&2
      exit 1
      ;;
    '#'*)
      echo "ERROR: GEOLIBRE_AUTH_USER must not start with '#' (htpasswd treats such lines as comments)." >&2
      exit 1
      ;;
  esac
  # An embedded newline would make `openssl passwd -stdin` hash each line
  # separately and corrupt the single-entry htpasswd; a CR (e.g. from a
  # CRLF-terminated --env-file) would silently become part of the stored
  # credential. Fail loudly instead.
  NL='
'
  CR=$(printf '\r')
  case "${GEOLIBRE_AUTH_USER}${GEOLIBRE_AUTH_PASSWORD}" in
    *"$NL"*|*"$CR"*)
      echo "ERROR: GEOLIBRE_AUTH_USER and GEOLIBRE_AUTH_PASSWORD must not contain newlines or carriage returns." >&2
      exit 1
      ;;
  esac
  # -6 = SHA-512 crypt (supported by nginx via glibc crypt(), stronger than
  # the MD5-based apr1); -stdin keeps the password out of openssl's argv.
  HASH=$(printf '%s\n' "$GEOLIBRE_AUTH_PASSWORD" | openssl passwd -6 -stdin)
  printf '%s:%s\n' "$GEOLIBRE_AUTH_USER" "$HASH" > "$HTPASSWD"
  # nginx workers (www-data) open the htpasswd at request time.
  chown root:www-data "$HTPASSWD"
  chmod 640 "$HTPASSWD"
  cat > "$AUTH_CONF" <<'EOF'
auth_basic "GeoLibre";
auth_basic_user_file /etc/nginx/.htpasswd;
EOF
  echo "HTTP Basic Auth enabled for user '$GEOLIBRE_AUTH_USER'."
else
  printf '# Basic Auth disabled (GEOLIBRE_AUTH_USER/GEOLIBRE_AUTH_PASSWORD not set).\n' > "$AUTH_CONF"
  rm -f "$HTPASSWD"
fi

if [ "${GEOLIBRE_DISABLE_SIDECAR:-0}" != "1" ]; then
  python -m uvicorn geolibre_server.app.main:app \
    --host 127.0.0.1 --port 8765 &
fi

exec nginx -g 'daemon off;'
