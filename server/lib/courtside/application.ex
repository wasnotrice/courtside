defmodule Courtside.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      CourtsideWeb.Telemetry,
      Courtside.Repo,
      {DNSCluster, query: Application.get_env(:courtside, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: Courtside.PubSub},
      # Start a worker by calling: Courtside.Worker.start_link(arg)
      # {Courtside.Worker, arg},
      # Start to serve requests, typically the last entry
      CourtsideWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: Courtside.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    CourtsideWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
