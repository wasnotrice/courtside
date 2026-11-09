defmodule Courtside.Schema.Season do
  @moduledoc """
  One school year at an organization, shared by all its programs.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "seasons" do
    field :name, :string
    field :starts_on, :date
    field :ends_on, :date
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
