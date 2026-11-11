defmodule Courtside.Repo.Migrations.AddGames do
  use Ecto.Migration

  # Games and plays (docs/games-plan.md, phase 2), a team's default game rules, and the
  # change log. Synced tables follow the first migration: organization_id, version,
  # deleted, ids from the device.
  def change do
    alter table(:teams) do
      # Copied into each new game; null means the basketball module's default.
      add :default_rules, :map
    end

    create table(:games, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :organization_id, references(:organizations, type: :binary_id), null: false
      add :team_id, references(:teams, type: :binary_id), null: false
      add :date, :date, null: false
      add :opponent, :text, null: false
      add :home_away, :string, null: false, default: "home"
      add :status, :string, null: false, default: "live"
      add :rules, :map, null: false
      # The scorebook's final score, entered when the game is final. Optional.
      add :official_us, :integer
      add :official_them, :integer
      add :version, :bigint, null: false
      add :deleted, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create index(:games, [:organization_id, :version])
    create constraint(:games, :home_away_valid, check: "home_away IN ('home', 'away', 'neutral')")
    create constraint(:games, :status_valid, check: "status IN ('live', 'final', 'reviewed')")

    create constraint(:games, :official_scores_non_negative,
             check:
               "(official_us IS NULL OR official_us >= 0) AND (official_them IS NULL OR official_them >= 0)"
           )

    # One stat credited during a game. Assists and fouls drawn are part of the play
    # they belong to, not plays of their own.
    create table(:plays, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :organization_id, references(:organizations, type: :binary_id), null: false
      add :game_id, references(:games, type: :binary_id), null: false
      add :side, :string, null: false
      add :player_id, references(:players, type: :binary_id)
      add :stat, :string, null: false
      add :foul_type, :string
      add :assist_player_id, references(:players, type: :binary_id)
      add :drawn_by_player_id, references(:players, type: :binary_id)
      add :period, :integer, null: false
      # Seconds left in the period, and seconds into the film. Both optional.
      add :clock, :integer
      add :video_at, :float
      # Sorts the play-by-play: a key between the neighbors' keys.
      add :position, :text, null: false
      # When the device recorded the play, in milliseconds since 1970. Breaks ties.
      add :recorded_at, :bigint, null: false
      add :version, :bigint, null: false
      add :deleted, :boolean, null: false, default: false
      timestamps(type: :utc_datetime)
    end

    create index(:plays, [:organization_id, :version])
    create index(:plays, [:game_id])
    create constraint(:plays, :side_valid, check: "side IN ('us', 'them')")

    # Backstops for the rules in Courtside.Basketball; the mutators give the messages.
    create constraint(:plays, :them_has_no_player,
             check: "side = 'us' OR (player_id IS NULL AND assist_player_id IS NULL)"
           )

    create constraint(:plays, :assist_on_made_field_goal,
             check: "assist_player_id IS NULL OR stat IN ('fg2_made', 'fg3_made')"
           )

    create constraint(:plays, :period_positive, check: "period >= 1")
    create constraint(:plays, :clock_non_negative, check: "clock IS NULL OR clock >= 0")

    # Every change the server receives, accepted or refused, with each changed
    # field's value before and after. Append-only and never synced: it's read
    # through GET /api/history. Purge a student's data from here too.
    create table(:change_log, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :organization_id, references(:organizations, type: :binary_id), null: false
      add :version, :bigint, null: false
      add :client_id, :string, null: false
      add :mutation_id, :bigint, null: false
      add :name, :string, null: false
      add :args, :map, null: false
      add :accepted, :boolean, null: false
      add :reason, :text
      # The row the change wrote, as pull names it: "players", "results"…, and its
      # key (the id, or "<run id>/<player id>" for results).
      add :row_table, :string
      add :row_key, :string
      # %{"field" => [before, after]}
      add :changes, :map
      timestamps(type: :utc_datetime_usec, updated_at: false)
    end

    create index(:change_log, [:organization_id, :row_table, :row_key, :version])
    create index(:change_log, [:organization_id, :version])
  end
end
