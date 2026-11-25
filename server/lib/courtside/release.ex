defmodule Courtside.Release do
  @moduledoc """
  Tasks for the production release, run with `bin/courtside eval`, where Mix isn't
  available. The boot script (`rel/overlays/bin/boot`) runs `migrate/0` and, on a new
  volume, `after_restore/0`.

      fly ssh console -C '/app/bin/courtside eval "Courtside.Release.create_organization(\\"Central High\\")"'
  """

  import Ecto.Query

  alias Courtside.{Organizations, Repo}
  alias Courtside.Schema.Organization

  @app :courtside

  # The organization the web app uses until device tokens carry one: the web build's
  # default (web/src/lib/sync/index.svelte.ts).
  @pilot_organization "c0000000-0000-4000-8000-000000000001"

  def migrate do
    load_app()

    for repo <- repos() do
      {:ok, _, _} = Ecto.Migrator.with_repo(repo, &Ecto.Migrator.run(&1, :up, all: true))
    end
  end

  @doc """
  Creates the organization the web app uses (one school). Programs, teams and seasons
  are then set up in the app.
  """
  def create_organization(name, id \\ @pilot_organization) do
    with_repo(fn ->
      org = Organizations.create!(name, id)
      IO.puts("Created #{org.name} (#{org.id}).")
    end)
  end

  @doc """
  Gives every organization a new data id. Runs when the machine started on an empty
  volume: Litestream has just restored the database, maybe without its last few
  seconds of writes, so phones whose cursors are ahead of it must pull from scratch.
  On a brand-new database there are no organizations and it does nothing.
  """
  def after_restore do
    with_repo(fn ->
      ids = Repo.all(from o in Organization, select: o.id)
      Enum.each(ids, &Organizations.new_data_id!/1)
      IO.puts("New data id for #{length(ids)} organization(s).")
    end)
  end

  defp with_repo(fun) do
    load_app()
    {:ok, _, _} = Ecto.Migrator.with_repo(Repo, fn _repo -> fun.() end)
    :ok
  end

  defp repos, do: Application.fetch_env!(@app, :ecto_repos)

  defp load_app do
    Application.ensure_loaded(@app)
  end
end
