defmodule CourtsideWeb.Router do
  use CourtsideWeb, :router

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", CourtsideWeb do
    pipe_through :api

    post "/push", SyncController, :push
    get "/pull", SyncController, :pull
  end
end
