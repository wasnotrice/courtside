defmodule Courtside.Schema.Result do
  @moduledoc """
  One player's value, and optionally their own setup, in one drill run.\n  Clients address it by (drill run, player); the id is internal.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: true}
  schema "results" do
    field :drill_run_id, :binary_id
    field :player_id, :binary_id
    field :value, :float
    field :setup, :float
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
