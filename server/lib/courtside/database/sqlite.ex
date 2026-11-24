defmodule Courtside.Database.SQLite do
  @moduledoc """
  `Courtside.Database` on SQLite, in WAL mode.

  SQLite lets one transaction write at a time. A writing transaction starts with
  `BEGIN IMMEDIATE`, which takes the write lock up front, so pushes are serialized
  across the whole database, not just per organization, and no row locks are needed.
  Starting immediately matters once a push reads before its first write: a deferred
  transaction that has read can't wait for the write lock and fails with
  `SQLITE_BUSY` instead.
  A transaction that only reads sees one snapshot from its first read to its end.
  """
  @behaviour Courtside.Database

  alias Courtside.Repo

  @impl true
  def write_transaction(fun), do: Repo.transaction(fun, mode: :immediate)

  @impl true
  def read_transaction(fun), do: Repo.transaction(fun)

  @impl true
  def lock(query), do: query
end
