defmodule Courtside.Sync.Mutators do
  @moduledoc """
  Server-side mutations: the authoritative business rules. Each takes the
  client's args and a context, validates against current server state, and
  writes rows stamped with the push's version. Returns `:ok` or
  `{:error, reason}` where `reason` is shown to the coach.

  The context holds the push's `organization_id` and `version`. Every row a
  mutation reads must belong to that organization, and every row it writes is
  stamped with it. Once sign-in exists, the context also carries the user, and
  permission checks belong here.

  A `*.put` mutation creates its row when the id is new (and then needs the
  required fields) and otherwise changes only the fields it sends, so edits to
  different fields on different devices don't overwrite each other. A field
  sent as null is set to null; a field left out keeps its value.

  The client has matching mutators in `web/src/lib/sync/mutators.ts` so it can
  show results instantly; when the two disagree, the server wins. The shared
  cases in `spec/mutations/` keep them in step.
  """

  import Ecto.Changeset
  import Ecto.Query

  alias Courtside.{Basketball, Repo}

  alias Courtside.Schema.{
    Drill,
    DrillRun,
    Game,
    Play,
    Player,
    Program,
    Result,
    RosterEntry,
    Season,
    Team
  }

  @type ctx :: %{organization_id: String.t(), version: pos_integer()}

  @typedoc """
  What an accepted change wrote, for the change log: the row as pull names it, and each
  changed field's value before and after.
  """
  @type log :: %{row_table: String.t(), row_key: String.t(), changes: map()}

  # The arguments each mutation accepts. Anything else is refused rather than
  # silently dropped by `cast`, so a field name the client and server disagree
  # on fails loudly. Matches FIELDS in web/src/lib/sync/mutators.ts.
  @fields %{
    "program.put" => ~w(id name sport),
    "season.put" => ~w(id name starts_on ends_on),
    "team.put" => ~w(id program_id name default_rules),
    "player.put" => ~w(id program_id name),
    "roster.put" => ~w(id team_id season_id player_id jersey),
    "roster.remove" => ~w(id),
    "drill.put" => ~w(id program_id name kind default_setup archived game_stat),
    "run.create" => ~w(id program_id date drill_id setup),
    "run.set_setup" => ~w(id setup),
    "run.delete" => ~w(id),
    "result.set_value" => ~w(drill_run_id player_id value),
    "result.set_setup" => ~w(drill_run_id player_id setup),
    "result.clear" => ~w(drill_run_id player_id),
    "game.put" => ~w(id team_id date opponent home_away status rules official_us official_them),
    "game.delete" => ~w(id),
    "play.put" =>
      ~w(id game_id side player_id stat foul_type assist_player_id drawn_by_player_id period clock video_at position recorded_at),
    "play.delete" => ~w(id)
  }

  @doc """
  Applies one mutation. `{:ok, log}` when it wrote a row, `:ok` when it was accepted
  but changed nothing (deleting something already gone), `{:error, reason}` when refused.
  """
  @spec run(String.t(), map(), ctx()) :: :ok | {:ok, log()} | {:error, String.t()}
  def run(name, args, ctx) do
    case @fields do
      %{^name => fields} ->
        # Args that aren't a map crash here, and Sync turns the crash into a rejection.
        case args |> Map.keys() |> Kernel.--(fields) |> Enum.sort() do
          [] -> dispatch(name, args, ctx)
          [field | _] -> {:error, "Unknown field: #{field}"}
        end

      _ ->
        {:error, "Unknown change type: #{name}"}
    end
  end

  defp dispatch("program.put", args, ctx), do: put_program(args, ctx)
  defp dispatch("season.put", args, ctx), do: put_season(args, ctx)
  defp dispatch("team.put", args, ctx), do: put_team(args, ctx)
  defp dispatch("player.put", args, ctx), do: put_player(args, ctx)
  defp dispatch("roster.put", args, ctx), do: put_roster_entry(args, ctx)
  defp dispatch("roster.remove", args, ctx), do: remove_roster_entry(args, ctx)
  defp dispatch("drill.put", args, ctx), do: put_drill(args, ctx)
  defp dispatch("run.create", args, ctx), do: create_run(args, ctx)
  defp dispatch("run.set_setup", args, ctx), do: set_run_setup(args, ctx)
  defp dispatch("run.delete", args, ctx), do: delete_run(args, ctx)
  defp dispatch("result.set_value", args, ctx), do: set_result_value(args, ctx)
  defp dispatch("result.set_setup", args, ctx), do: set_result_setup(args, ctx)
  defp dispatch("result.clear", args, ctx), do: clear_result(args, ctx)
  defp dispatch("game.put", args, ctx), do: put_game(args, ctx)
  defp dispatch("game.delete", args, ctx), do: delete_game(args, ctx)
  defp dispatch("play.put", args, ctx), do: put_play(args, ctx)
  defp dispatch("play.delete", args, ctx), do: delete_play(args, ctx)

  # --- programs, seasons and teams ------------------------------------------

  defp put_program(args, ctx) do
    with {:ok, existing} <- load_for_put(Program, args["id"], ctx) do
      (existing || %Program{id: args["id"], organization_id: ctx.organization_id})
      |> cast(args, [:name, :sport])
      |> trim_name()
      |> validate_required([:name, :sport])
      |> validate_length(:name, max: 100)
      |> validate_inclusion(:sport, Program.sports(), message: "must be basketball")
      |> validate_unchanged(:sport, existing, "can't change after the program is created")
      |> save(ctx)
    end
  end

  defp put_season(args, ctx) do
    with {:ok, existing} <- load_for_put(Season, args["id"], ctx) do
      cs =
        (existing || %Season{id: args["id"], organization_id: ctx.organization_id})
        |> cast(args, [:name, :starts_on, :ends_on])
        |> trim_name()
        |> validate_required([:name, :starts_on, :ends_on])
        |> validate_length(:name, max: 100)
        |> validate_dates_ordered()

      with :ok <- check_no_overlap(cs, ctx), do: save(cs, ctx)
    end
  end

  defp validate_dates_ordered(cs) do
    starts = get_field(cs, :starts_on)
    ends = get_field(cs, :ends_on)

    if cs.valid? and Date.compare(ends, starts) == :lt,
      do: add_error(cs, :ends_on, "must be on or after the start date"),
      else: cs
  end

  # Safe without a database constraint: pushes in one organization are serialized.
  defp check_no_overlap(%{valid?: false}, _ctx), do: :ok

  defp check_no_overlap(cs, ctx) do
    id = get_field(cs, :id)
    starts = get_field(cs, :starts_on)
    ends = get_field(cs, :ends_on)

    overlapping =
      from(s in Season,
        where:
          s.organization_id == ^ctx.organization_id and not s.deleted and s.id != ^id and
            s.starts_on <= ^ends and s.ends_on >= ^starts,
        select: s.name,
        limit: 1
      )
      |> Repo.one()

    if overlapping, do: {:error, "Overlaps the #{overlapping} season."}, else: :ok
  end

  defp put_team(args, ctx) do
    with {:ok, existing} <- load_for_put(Team, args["id"], ctx),
         {:ok, _program} <- fetch_program(args, existing, ctx) do
      (existing || %Team{id: args["id"], organization_id: ctx.organization_id})
      |> cast(args, [:program_id, :name, :default_rules])
      |> trim_name()
      |> validate_required([:name])
      |> validate_length(:name, max: 100)
      |> validate_unchanged(:program_id, existing, "can't change after the team is created")
      |> validate_rules(:default_rules)
      |> save(ctx)
    end
  end

  # --- players and roster entries -------------------------------------------

  defp put_player(args, ctx) do
    with {:ok, existing} <- load_for_put(Player, args["id"], ctx),
         {:ok, _program} <- fetch_program(args, existing, ctx) do
      (existing || %Player{id: args["id"], organization_id: ctx.organization_id})
      |> cast(args, [:program_id, :name])
      |> trim_name()
      |> validate_required([:name])
      |> validate_length(:name, max: 100)
      |> validate_unchanged(:program_id, existing, "can't change after the player is created")
      |> save(ctx)
    end
  end

  defp put_roster_entry(args, ctx) do
    with {:ok, existing} <- load_for_put(RosterEntry, args["id"], ctx),
         :ok <- check_entry_unmoved(existing, args),
         {:ok, team} <-
           fetch_live(
             Team,
             sent_or_stored(args, existing, :team_id),
             ctx,
             "That team no longer exists."
           ),
         {:ok, season} <-
           fetch_live(
             Season,
             sent_or_stored(args, existing, :season_id),
             ctx,
             "That season no longer exists."
           ),
         {:ok, player} <-
           fetch_live(
             Player,
             sent_or_stored(args, existing, :player_id),
             ctx,
             "That player no longer exists."
           ),
         :ok <- same_program(player, team, "That player is in a different program."),
         :ok <- check_not_on_roster(args["id"], team, season, player, ctx) do
      (existing || %RosterEntry{id: args["id"], organization_id: ctx.organization_id})
      |> cast(args, [:team_id, :season_id, :player_id, :jersey])
      |> default_if_nil(:jersey, "")
      |> validate_length(:jersey, max: 10)
      |> unique_constraint(:player_id,
        name: :roster_entries_once_per_team_season,
        message: "is already on that team this season"
      )
      # put_roster_entry revives a removed entry with the same id.
      |> put_change(:deleted, false)
      |> save(ctx)
    end
  end

  defp check_entry_unmoved(nil, _args), do: :ok

  # Only the fields sent can move it; fields left out keep their values.
  defp check_entry_unmoved(entry, args) do
    moved =
      Enum.any?([:team_id, :season_id, :player_id], fn field ->
        sent_or_stored(args, entry, field) != Map.fetch!(entry, field)
      end)

    if moved,
      do: {:error, "A roster entry can't move. Remove it and add a new one."},
      else: :ok
  end

  defp check_not_on_roster(id, team, season, player, ctx) do
    taken =
      from(e in RosterEntry,
        where:
          e.organization_id == ^ctx.organization_id and not e.deleted and
            e.team_id == ^team.id and e.season_id == ^season.id and
            e.player_id == ^player.id and e.id != ^id
      )
      |> Repo.exists?()

    if taken, do: {:error, "Already on that team this season."}, else: :ok
  end

  defp remove_roster_entry(%{"id" => id}, ctx) do
    case fetch_live(RosterEntry, id, ctx, :missing) do
      {:ok, entry} -> entry |> change(deleted: true) |> save(ctx)
      {:error, :missing} -> :ok
    end
  end

  # --- drills and runs ------------------------------------------------------

  defp put_drill(args, ctx) do
    with {:ok, existing} <- load_for_put(Drill, args["id"], ctx),
         {:ok, _program} <- fetch_program(args, existing, ctx) do
      (existing || %Drill{id: args["id"], organization_id: ctx.organization_id})
      |> cast(args, [:program_id, :name, :kind, :default_setup, :archived, :game_stat])
      |> trim_name()
      |> validate_required([:name, :kind])
      |> validate_inclusion(:kind, Drill.kinds(), message: "must be makes, count or time")
      |> validate_unchanged(:kind, existing, "can't change after the drill is created")
      |> validate_unchanged(:program_id, existing, "can't change after the drill is created")
      |> validate_setup(:default_setup)
      |> validate_inclusion(:game_stat, Drill.game_stats(), message: "must be ft, fg2 or fg3")
      |> validate_game_stat_kind()
      |> check_constraint(:kind, name: :kind_valid)
      |> check_constraint(:game_stat, name: :game_stat_valid)
      |> save(ctx)
    end
  end

  defp validate_game_stat_kind(cs) do
    if get_field(cs, :game_stat) && get_field(cs, :kind) != "makes",
      do: add_error(cs, :game_stat, "", problem: "Only a makes drill can match a game stat"),
      else: cs
  end

  defp create_run(args, ctx) do
    with {:ok, program} <- fetch_program(args, nil, ctx),
         {:ok, drill} <- fetch_live(Drill, args["drill_id"], ctx, "That drill no longer exists."),
         :ok <- same_program(drill, program, "That drill is in a different program."),
         :ok <- check_new_id(DrillRun, args["id"], ctx) do
      cs =
        %DrillRun{id: args["id"], organization_id: ctx.organization_id}
        |> cast(args, [:program_id, :date, :drill_id, :setup])
        |> validate_required([:date])
        |> validate_setup_for(drill.kind)

      with :ok <- check_in_season(cs, ctx), do: save(cs, ctx)
    end
  end

  defp check_in_season(%{valid?: false}, _ctx), do: :ok

  defp check_in_season(cs, ctx) do
    date = get_field(cs, :date)

    in_season =
      from(s in Season,
        where:
          s.organization_id == ^ctx.organization_id and not s.deleted and
            s.starts_on <= ^date and s.ends_on >= ^date
      )
      |> Repo.exists?()

    if in_season, do: :ok, else: {:error, "No season includes that date."}
  end

  defp set_run_setup(args, ctx) do
    with {:ok, run} <-
           fetch_live(DrillRun, args["id"], ctx, "That drill was removed from the practice."),
         drill = Repo.get!(Drill, run.drill_id),
         cs = run |> cast(args, [:setup]) |> validate_setup_for(drill.kind),
         :ok <- check_makes_fit(drill, run.id, get_field(cs, :setup)) do
      save(cs, ctx)
    end
  end

  # Makes can't exceed shots for any player who uses the run's setup.
  defp check_makes_fit(%Drill{kind: "makes"}, run_id, setup) do
    over =
      from(r in Result,
        join: p in Player,
        on: p.id == r.player_id,
        where:
          r.drill_run_id == ^run_id and not r.deleted and is_nil(r.setup) and r.value > ^setup,
        select: {p.name, r.value},
        limit: 1
      )
      |> Repo.one()

    case over do
      nil ->
        :ok

      {name, value} ->
        {:error, "#{name} has #{trunc(value)} makes, more than #{trunc(setup)} shots."}
    end
  end

  defp check_makes_fit(_drill, _run_id, _setup), do: :ok

  defp delete_run(%{"id" => id}, ctx) do
    case fetch_live(DrillRun, id, ctx, :missing) do
      {:error, :missing} ->
        :ok

      {:ok, run} ->
        {count, _} =
          from(r in Result, where: r.drill_run_id == ^run.id and not r.deleted)
          |> Repo.update_all(
            set: [deleted: true, version: ctx.version, updated_at: DateTime.utc_now(:second)]
          )

        with {:ok, log} <- run |> change(deleted: true) |> save(ctx),
             do: {:ok, put_in(log.changes["results_deleted"], [0, count])}
    end
  end

  # --- results --------------------------------------------------------------

  defp set_result_value(args, ctx) do
    with {:ok, run, drill} <- fetch_run_and_drill(args, ctx),
         {:ok, player} <- fetch_result_player(args, ctx),
         :ok <- same_program(player, run, "That player is in a different program."),
         result = get_result(run.id, player.id, ctx),
         {:ok, value} <- parse_value(drill.kind, args["value"], result.setup || run.setup) do
      result
      |> change(value: value, deleted: false)
      |> save(ctx)
    end
  end

  defp set_result_setup(args, ctx) do
    with {:ok, run, drill} <- fetch_run_and_drill(args, ctx),
         {:ok, player} <- fetch_result_player(args, ctx),
         :ok <- same_program(player, run, "That player is in a different program."),
         result = get_result(run.id, player.id, ctx),
         cs = result |> cast(args, [:setup]) |> validate_setup(:setup),
         :ok <- check_own_makes_fit(drill, result, get_field(cs, :setup) || run.setup) do
      # deleted: false revives a cleared result, so the override reaches clients.
      cs |> change(deleted: false) |> save(ctx)
    end
  end

  defp check_own_makes_fit(%Drill{kind: "makes"}, %Result{value: value}, setup)
       when is_number(value) and is_number(setup) and value > setup,
       do: {:error, "#{trunc(value)} makes is more than #{trunc(setup)} shots."}

  defp check_own_makes_fit(_drill, _result, _setup), do: :ok

  defp clear_result(args, ctx) do
    with {:ok, run_id} <- Ecto.UUID.cast(args["drill_run_id"] || ""),
         {:ok, player_id} <- Ecto.UUID.cast(args["player_id"] || ""),
         %Result{deleted: false} = result <-
           Repo.get_by(Result,
             drill_run_id: run_id,
             player_id: player_id,
             organization_id: ctx.organization_id
           ) do
      result
      |> change(value: nil, setup: nil, deleted: true)
      |> save(ctx)
    else
      _ -> :ok
    end
  end

  defp fetch_result_player(args, ctx),
    do: fetch_live(Player, args["player_id"], ctx, "That player is no longer on the roster.")

  defp get_result(run_id, player_id, ctx) do
    Repo.get_by(Result, drill_run_id: run_id, player_id: player_id) ||
      %Result{drill_run_id: run_id, player_id: player_id, organization_id: ctx.organization_id}
  end

  defp parse_value(_kind, value, _setup) when not is_number(value),
    do: {:error, "Enter a number."}

  defp parse_value(_kind, value, _setup) when value < 0,
    do: {:error, "Results can't be negative."}

  defp parse_value("makes", value, setup) do
    cond do
      value != trunc(value) ->
        {:error, "Makes must be a whole number."}

      is_number(setup) and value > setup ->
        {:error, "#{trunc(value)} makes is more than #{trunc(setup)} shots."}

      true ->
        {:ok, value / 1}
    end
  end

  defp parse_value("time", value, _setup) when value == 0,
    do: {:error, "Time must be above zero."}

  defp parse_value(_kind, value, _setup), do: {:ok, value / 1}

  # --- games and plays ------------------------------------------------------

  defp put_game(args, ctx) do
    with {:ok, existing} <- load_for_put(Game, args["id"], ctx),
         {:ok, team} <-
           fetch_live(
             Team,
             sent_or_stored(args, existing, :team_id),
             ctx,
             "That team no longer exists."
           ) do
      cs =
        (existing || %Game{id: args["id"], organization_id: ctx.organization_id})
        |> cast(args, [
          :team_id,
          :date,
          :opponent,
          :home_away,
          :status,
          :rules,
          :official_us,
          :official_them
        ])
        |> validate_unchanged(:team_id, existing, "can't change after the game is created")
        |> default_rules(existing, team)
        |> trim(:opponent)
        |> validate_required([:date, :opponent, :rules])
        |> validate_length(:opponent, max: 100)
        |> validate_inclusion(:home_away, ~w(home away neutral),
          message: "must be home, away or neutral"
        )
        |> validate_inclusion(:status, ~w(live final reviewed),
          message: "must be live, final or reviewed"
        )
        |> validate_number(:official_us, greater_than_or_equal_to: 0)
        |> validate_number(:official_them, greater_than_or_equal_to: 0)
        |> validate_rules(:rules)

      with :ok <- check_in_season(cs, ctx), do: save(cs, ctx)
    end
  end

  # A new game copies its team's rules, or the default, unless it brings its own.
  defp default_rules(cs, nil, team) do
    if get_field(cs, :rules) == nil,
      do: put_change(cs, :rules, team.default_rules || Basketball.default_rules()),
      else: cs
  end

  defp default_rules(cs, _existing, _team), do: cs

  defp validate_rules(cs, field) do
    case get_change(cs, field) do
      nil ->
        cs

      rules ->
        case Basketball.rules_problem(rules) do
          nil -> cs
          problem -> add_error(cs, field, "are invalid", problem: problem)
        end
    end
  end

  defp delete_game(%{"id" => id}, ctx) do
    case fetch_live(Game, id, ctx, :missing) do
      {:error, :missing} ->
        :ok

      {:ok, game} ->
        {count, _} =
          from(p in Play, where: p.game_id == ^game.id and not p.deleted)
          |> Repo.update_all(
            set: [deleted: true, version: ctx.version, updated_at: DateTime.utc_now(:second)]
          )

        with {:ok, log} <- game |> change(deleted: true) |> save(ctx),
             do: {:ok, put_in(log.changes["plays_deleted"], [0, count])}
    end
  end

  @play_fields [
    :game_id,
    :side,
    :player_id,
    :stat,
    :foul_type,
    :assist_player_id,
    :drawn_by_player_id,
    :period,
    :clock,
    :video_at,
    :position,
    :recorded_at
  ]

  # The checks run in this order on both sides, so a play with one problem gets the
  # same message from the phone and the server.
  defp put_play(args, ctx) do
    with {:ok, existing} <- load_for_put(Play, args["id"], ctx),
         :ok <- check_play_live(existing, args),
         {:ok, game} <-
           fetch_live(
             Game,
             sent_or_stored(args, existing, :game_id),
             ctx,
             "That game was deleted."
           ),
         cs =
           (existing || %Play{id: args["id"], organization_id: ctx.organization_id})
           |> cast(args, @play_fields)
           |> validate_unchanged(:game_id, existing, "can't change after the play is recorded")
           |> default_foul_type()
           |> validate_required([:side, :stat, :period, :position, :recorded_at])
           |> validate_inclusion(:side, ~w(us them), message: "must be us or them")
           |> validate_inclusion(:stat, Basketball.stats(), message: "is invalid")
           |> validate_number(:period, greater_than: 0)
           |> validate_number(:clock, greater_than_or_equal_to: 0)
           |> validate_number(:video_at, greater_than_or_equal_to: 0),
         :ok <- if(cs.valid?, do: :ok, else: {:error, describe(cs)}),
         :ok <- check_play_rules(cs, game, ctx) do
      save(cs, ctx)
    end
  end

  defp check_play_live(%Play{deleted: true}, _args), do: {:error, "That play was deleted."}

  # An edit (no game_id) to a play that doesn't exist: the phone never sees deleted
  # plays, so this is how one reaches the server.
  defp check_play_live(nil, args) when not is_map_key(args, "game_id"),
    do: {:error, "That play was deleted."}

  defp check_play_live(_existing, _args), do: :ok

  # A foul is personal unless it says otherwise.
  defp default_foul_type(cs) do
    if get_field(cs, :stat) == "foul" and get_field(cs, :foul_type) == nil,
      do: put_change(cs, :foul_type, "personal"),
      else: cs
  end

  defp check_play_rules(cs, game, ctx) do
    play = Map.new(@play_fields, &{&1, get_field(cs, &1)})
    team = Repo.get!(Team, game.team_id)

    cond do
      play.side == "them" and play.player_id != nil ->
        {:error, "The other team's plays can't have a player."}

      play.assist_player_id != nil and
          not (play.side == "us" and play.stat in Basketball.made_field_goals()) ->
        {:error, "Only made shots can have an assist."}

      play.assist_player_id != nil and play.assist_player_id == play.player_id ->
        {:error, "A player can't assist their own shot."}

      play.foul_type != nil and play.stat != "foul" ->
        {:error, "Only fouls have a foul type."}

      play.foul_type != nil and play.foul_type not in Basketball.foul_types() ->
        {:error, "Foul type is invalid"}

      play.drawn_by_player_id != nil and not (play.side == "them" and play.stat == "foul") ->
        {:error, "Only the other team's fouls can be drawn."}

      true ->
        with :ok <- check_play_players(play, team, ctx), do: check_clock(play, game)
    end
  end

  defp check_play_players(play, team, ctx) do
    [play.player_id, play.assist_player_id, play.drawn_by_player_id]
    |> Enum.reject(&is_nil/1)
    |> Enum.reduce_while(:ok, fn id, :ok ->
      with {:ok, player} <-
             fetch_live(Player, id, ctx, "That player is no longer on the roster."),
           :ok <- same_program(player, team, "That player is in a different program.") do
        {:cont, :ok}
      else
        error -> {:halt, error}
      end
    end)
  end

  defp check_clock(%{clock: nil}, _game), do: :ok

  defp check_clock(play, game) do
    if play.clock > Basketball.period_seconds(game.rules, play.period),
      do: {:error, "Clock is more than the period's length."},
      else: :ok
  end

  defp delete_play(%{"id" => id}, ctx) do
    case fetch_live(Play, id, ctx, :missing) do
      {:ok, play} -> play |> change(deleted: true) |> save(ctx)
      {:error, :missing} -> :ok
    end
  end

  # --- shared ---------------------------------------------------------------

  defp fetch_run_and_drill(args, ctx) do
    with {:ok, run} <-
           fetch_live(
             DrillRun,
             args["drill_run_id"],
             ctx,
             "That drill was removed from the practice."
           ) do
      {:ok, run, Repo.get!(Drill, run.drill_id)}
    end
  end

  defp fetch_program(args, existing, ctx),
    do:
      fetch_live(
        Program,
        sent_or_stored(args, existing, :program_id),
        ctx,
        "That program no longer exists."
      )

  # A field's value after a put: the one sent, or the stored one if it was left out.
  defp sent_or_stored(args, existing, field) do
    case Map.fetch(args, Atom.to_string(field)) do
      {:ok, value} -> value
      :error -> existing && Map.fetch!(existing, field)
    end
  end

  # A live row in the push's organization, or {:error, message}. Rows in other
  # organizations are invisible: referring to one gets the same message as
  # referring to a row that doesn't exist.
  defp fetch_live(schema, id, ctx, message) do
    org = ctx.organization_id

    with {:ok, uuid} <- Ecto.UUID.cast(id || ""),
         %{deleted: false, organization_id: ^org} = row <- Repo.get(schema, uuid) do
      {:ok, row}
    else
      _ -> {:error, message}
    end
  end

  # Ids are unique across the whole database, so a row can't be created with an
  # id another organization holds. That's refused with the generic message, as
  # for a crash, so it reveals nothing about the other organization. It only
  # happens if a UUID is reused.
  @foreign_id "The server could not apply this change."

  # The row a *.put mutation updates, or nil to create one. An id that isn't a
  # UUID crashes in Repo.get, which Sync turns into a rejection.
  defp load_for_put(schema, id, ctx) do
    org = ctx.organization_id

    case Repo.get(schema, id) do
      nil -> {:ok, nil}
      %{organization_id: ^org} = row -> {:ok, row}
      _ -> {:error, @foreign_id}
    end
  end

  defp check_new_id(schema, id, ctx) do
    org = ctx.organization_id

    case Repo.get(schema, id) do
      nil -> :ok
      %{organization_id: ^org} -> {:error, "Id already exists"}
      _ -> {:error, @foreign_id}
    end
  end

  defp same_program(%{program_id: a}, %Program{id: b}, message), do: same(a, b, message)
  defp same_program(%{program_id: a}, %{program_id: b}, message), do: same(a, b, message)

  defp same(a, a, _message), do: :ok
  defp same(_a, _b, message), do: {:error, message}

  defp validate_unchanged(cs, _field, nil, _message), do: cs

  defp validate_unchanged(cs, field, existing, message) do
    if get_field(cs, field) == Map.fetch!(existing, field),
      do: cs,
      else: add_error(cs, field, message)
  end

  defp trim_name(cs), do: trim(cs, :name)

  # cast turns a blank string into nil, which an edit then sends as a change.
  defp trim(cs, field),
    do: update_change(cs, field, &if(is_binary(&1), do: String.trim(&1), else: &1))

  defp validate_setup_for(cs, "makes"),
    do: cs |> validate_required([:setup], message: "shots are required") |> validate_setup(:setup)

  defp validate_setup_for(cs, _kind), do: validate_setup(cs, :setup)

  defp default_if_nil(cs, field, default) do
    if get_field(cs, field) == nil, do: put_change(cs, field, default), else: cs
  end

  defp validate_setup(cs, field), do: validate_number(cs, field, greater_than: 0)

  # Writes the row at the push's version and returns what changed, for the change log.
  defp save(cs, ctx) do
    changes = changed_fields(cs)

    case cs |> put_change(:version, ctx.version) |> Repo.insert_or_update() do
      {:ok, row} -> {:ok, %{row_table: wire_table(row), row_key: row_key(row), changes: changes}}
      {:error, %Ecto.Changeset{} = cs} -> {:error, describe(cs)}
    end
  end

  # %{"field" => [before, after]}; before is nil for a new row.
  defp changed_fields(cs) do
    new? = cs.data.__meta__.state == :built

    for {field, value} <- cs.changes,
        field not in [:version, :inserted_at, :updated_at],
        into: %{},
        do: {Atom.to_string(field), [if(new?, do: nil, else: Map.get(cs.data, field)), value]}
  end

  # The table and key a row has in pull.
  defp wire_table(%Program{}), do: "programs"
  defp wire_table(%Season{}), do: "seasons"
  defp wire_table(%Team{}), do: "teams"
  defp wire_table(%Player{}), do: "players"
  defp wire_table(%RosterEntry{}), do: "roster_entries"
  defp wire_table(%Drill{}), do: "drills"
  defp wire_table(%DrillRun{}), do: "runs"
  defp wire_table(%Result{}), do: "results"
  defp wire_table(%Game{}), do: "games"
  defp wire_table(%Play{}), do: "plays"

  defp row_key(%Result{drill_run_id: run, player_id: player}), do: "#{run}/#{player}"
  defp row_key(%{id: id}), do: id

  defp describe(cs) do
    cs
    |> traverse_errors(fn
      {_msg, [problem: problem]} ->
        {:full, problem}

      {msg, opts} ->
        Enum.reduce(opts, msg, fn {k, val}, acc ->
          String.replace(acc, "%{#{k}}", to_string(val))
        end)
    end)
    |> Enum.map_join("; ", fn
      {_field, [{:full, problem} | _]} -> problem
      {field, msgs} -> "#{humanize(field)} #{Enum.join(msgs, ", ")}"
    end)
  end

  # program_id -> "Program", default_setup -> "Default setup".
  defp humanize(field),
    do:
      field
      |> to_string()
      |> String.replace_suffix("_id", "")
      |> String.replace("_", " ")
      |> String.capitalize()
end
