defmodule Courtside.Schema.Play do
  @moduledoc """
  One stat credited during a game, to a player, to the team as a whole, or to the
  opponent. An assist is part of a made shot, and a foul drawn part of the opponent's
  foul, not plays of their own.

  Synced: carries `organization_id`, `version` and `deleted`.
  """
  use Ecto.Schema

  @primary_key {:id, :binary_id, autogenerate: false}
  schema "plays" do
    field :game_id, :binary_id
    field :side, :string
    field :player_id, :binary_id
    field :stat, :string
    field :foul_type, :string
    field :assist_player_id, :binary_id
    field :drawn_by_player_id, :binary_id
    field :period, :integer
    field :clock, :integer
    field :video_at, :float
    field :position, :string
    field :recorded_at, :integer
    field :organization_id, :binary_id
    field :version, :integer
    field :deleted, :boolean, default: false
    timestamps(type: :utc_datetime)
  end
end
