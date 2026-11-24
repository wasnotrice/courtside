defmodule Courtside.Database do
  @moduledoc """
  What the sync needs from the database that Ecto doesn't hide: how pushes are
  serialized and how a pull reads one consistent snapshot. Everything else is plain
  Ecto, so this is the only module that changes with the database.

  Courtside runs on SQLite (`Courtside.Database.SQLite`). To move to Postgres, add a
  module implementing this behaviour and pick it in `impl/0`:

    * `write_transaction/1`: `Repo.transaction/1`. Pushes are serialized because each
      one first updates its organization's row in `org_versions`, which holds that
      row's lock until commit.
    * `read_transaction/1`: `Repo.transaction/1` that first runs
      `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`. The SQL sandbox
      refuses `SET TRANSACTION` inside its wrapping transaction, so tests in the
      sandbox need to skip it.
    * `lock/1`: `Ecto.Query.lock(query, "FOR UPDATE")`.

  The migrations run on either database. The Postgres version of the sync code is in
  git history, before the move to SQLite.
  """

  @doc """
  Runs `fun` in a transaction that writes. Writing transactions run one at a time, at
  least within an organization, so versions are handed out in commit order (ADR 0001).
  """
  @callback write_transaction((-> result)) :: {:ok, result} | {:error, term()}
            when result: term()

  @doc "Runs `fun` in a transaction whose reads all see one snapshot of the database."
  @callback read_transaction((-> result)) :: {:ok, result} | {:error, term()}
            when result: term()

  @doc """
  Marks `query` as reading rows the current write transaction will update, so no
  other transaction changes them before it commits.
  """
  @callback lock(Ecto.Queryable.t()) :: Ecto.Queryable.t()

  @impl_module (case Courtside.Repo.__adapter__() do
                  Ecto.Adapters.SQLite3 -> Courtside.Database.SQLite
                end)

  @doc "The implementation for the repo's adapter."
  def impl, do: @impl_module

  def write_transaction(fun), do: @impl_module.write_transaction(fun)
  def read_transaction(fun), do: @impl_module.read_transaction(fun)
  def lock(query), do: @impl_module.lock(query)
end
