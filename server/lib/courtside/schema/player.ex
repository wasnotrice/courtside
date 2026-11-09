defmodule Courtside.Schema.Player do
  @moduledoc """
  A person in a program.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "players" do
    field :program_id, :binary_id
    field :name, :string
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
