defmodule Courtside.Schema.Program do
  @moduledoc """
  One sport for one gender at an organization, such as girls' basketball.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @sports ~w(basketball)
  def sports, do: @sports

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "programs" do
    field :name, :string
    field :sport, :string
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
