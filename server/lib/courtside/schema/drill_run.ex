defmodule Courtside.Schema.DrillRun do
  @moduledoc """
  One drill done at one practice. Its season comes from its date.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "drill_runs" do
    field :program_id, :binary_id
    field :date, :date
    field :drill_id, :binary_id
    field :setup, :float
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
