defmodule Courtside.Schema.Team do
  @moduledoc """
  One level within a program, such as varsity or JV.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "teams" do
    field :program_id, :binary_id
    field :name, :string
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
