defmodule CourtsideWeb.Router do
  use CourtsideWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", CourtsideWeb do
    pipe_through :api

    post "/push", SyncController, :push
    get "/pull", SyncController, :pull
    get "/history", SyncController, :history
    get "/health", AppController, :health
  end

  # Anything else under /api is a JSON 404, not the web app.
  scope "/api", CourtsideWeb do
    pipe_through :api
    match :*, "/*path", AppController, :not_found
  end

  # Every other GET is a route of the web app.
  scope "/", CourtsideWeb do
    get "/*path", AppController, :index
  end
end
