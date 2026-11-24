defmodule Courtside.Schema.OrgVersion do
  @moduledoc """
  An organization's version counter and data id (see `Courtside.Sync`). Not synced.
  """
  use Ecto.Schema

  @primary_key {:organization_id, :binary_id, autogenerate: false}
  schema "org_versions" do
    field :version, :integer, default: 0
    field :data_id, :binary_id
  end
end
