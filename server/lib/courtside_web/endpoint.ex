defmodule CourtsideWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :courtside

  # The session will be stored in the cookie and signed,
  # this means its contents can be read but not tampered with.
  # Set :encryption_salt if you would also like to encrypt it.
  @session_options [
    store: :cookie,
    key: "_courtside_key",
    signing_salt: "Ex9Tcp0x",
    same_site: "Lax"
  ]

  socket "/socket", CourtsideWeb.SyncSocket, websocket: true, longpoll: false

  # The web app's files, from priv/static (the release copies web/build there). The
  # release's Dockerfile gzips them, so `gzip` serves the .gz copies.
  #
  # SvelteKit puts a hash in every file name under _app/immutable, so those can be
  # cached for good. Everything else (index.html, service-worker.js) is revalidated
  # on each request, so a deploy reaches phones on their next load.
  plug Plug.Static,
    at: "/_app/immutable",
    from: {:courtside, "priv/static/_app/immutable"},
    gzip: not code_reloading?,
    cache_control_for_etags: "public, max-age=31536000, immutable"

  plug Plug.Static,
    at: "/",
    from: :courtside,
    gzip: not code_reloading?,
    only: CourtsideWeb.static_paths(),
    cache_control_for_etags: "no-cache",
    raise_on_missing_only: code_reloading?

  # Code reloading can be explicitly enabled under the
  # :code_reloader configuration of your endpoint.
  if code_reloading? do
    plug Phoenix.CodeReloader
    plug Phoenix.Ecto.CheckRepoStatus, otp_app: :courtside
  end

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]

  plug CourtsideWeb.Plugs.CORS

  # A push carries at most Courtside.Sync.max_mutations/0 mutations; 1 MB is
  # plenty for that and keeps one client from sending an enormous body.
  plug Plug.Parsers,
    parsers: [:urlencoded, :multipart, :json],
    pass: ["*/*"],
    length: 1_000_000,
    json_decoder: Phoenix.json_library()

  plug Plug.MethodOverride
  plug Plug.Head
  plug Plug.Session, @session_options
  plug CourtsideWeb.Router
end
