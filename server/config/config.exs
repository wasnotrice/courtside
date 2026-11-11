# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :courtside,
  ecto_repos: [Courtside.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

# Origins allowed to call the API from another address: the Tauri app on iOS
# and Android (phase 3). The web app is served from the API's own address in
# dev (through Vite's proxy), so it needs no entry here.
config :courtside,
  cors_origins: ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]

# Configure the endpoint
config :courtside, CourtsideWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [json: CourtsideWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Courtside.PubSub,
  live_view: [signing_salt: "Pv24Yt9x"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
