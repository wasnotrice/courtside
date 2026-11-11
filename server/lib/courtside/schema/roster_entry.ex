defmodule Courtside.Schema.RosterEntry do
  @moduledoc """
  A player's place on one team for one season, with the jersey worn there.

  Synced: carries `organization_id`, `version` (the organization's counter value
  from the push that last wrote it) and `deleted` (a tombstone).
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "roster_entries" do
    field :team_id, :binary_id
    field :season_id, :binary_id
    field :player_id, :binary_id
    field :jersey, :string, default: ""
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
