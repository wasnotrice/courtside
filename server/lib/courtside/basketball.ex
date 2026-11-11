defmodule Courtside.Basketball do
  @moduledoc """
  Basketball's stats and game rules: the sport-specific part of games (see
  docs/games-plan.md, "Generic vs. basketball-specific"). Matches
  web/src/lib/sync/basketball.ts; the shared cases in spec/mutations/ keep them in step.
  """

  @stats ~w(ft_made ft_missed fg2_made fg2_missed fg3_made fg3_missed oreb dreb stl blk tov foul)
  @made_field_goals ~w(fg2_made fg3_made)
  @foul_types ~w(personal offensive technical flagrant)

  def stats, do: @stats
  def made_field_goals, do: @made_field_goals
  def foul_types, do: @foul_types

  @doc """
  The rules a game uses when neither it nor its team says otherwise.

  PROVISIONAL: these are believed to be the current NFHS high school rules (4 × 8-minute
  quarters, team fouls reset each quarter, two shots from the 5th). Check them against
  the rule book before games ship (plan, phase 2 step 4).
  """
  def default_rules do
    %{
      "periods" => 4,
      "period_minutes" => 8,
      "overtime_minutes" => 4,
      "team_fouls_reset" => "period",
      "bonus_at" => 5,
      "bonus" => "two_shots",
      "double_bonus_at" => nil,
      "foul_out_at" => 5,
      "technicals_to_eject" => 2
    }
  end

  # Each key, and what its value must be. Null is allowed only for double_bonus_at.
  @rule_checks [
    {"periods", :positive_integer},
    {"period_minutes", :positive_number},
    {"overtime_minutes", :positive_number},
    {"team_fouls_reset", {:one_of, ~w(period half)}},
    {"bonus_at", :positive_integer},
    {"bonus", {:one_of, ~w(one_and_one two_shots)}},
    {"double_bonus_at", {:nullable, :positive_integer}},
    {"foul_out_at", :positive_integer},
    {"technicals_to_eject", :positive_integer}
  ]

  @doc "Nil if `rules` is a valid rules object, otherwise the reason."
  def rules_problem(rules) when is_map(rules) do
    keys = Enum.map(@rule_checks, &elem(&1, 0))

    case Enum.sort(Map.keys(rules) -- keys) do
      [extra | _] ->
        "Rules are invalid: #{extra}"

      [] ->
        Enum.find_value(@rule_checks, fn {key, check} ->
          if !Map.has_key?(rules, key) or !valid?(check, rules[key]),
            do: "Rules are invalid: #{key}"
        end)
    end
  end

  def rules_problem(_rules), do: "Rules are invalid."

  defp valid?(:positive_integer, v), do: is_integer(v) and v > 0
  defp valid?(:positive_number, v), do: is_number(v) and v > 0
  defp valid?({:one_of, list}, v), do: v in list
  defp valid?({:nullable, _check}, nil), do: true
  defp valid?({:nullable, check}, v), do: valid?(check, v)

  @doc "A period's length in seconds under `rules`: regulation, or overtime after it."
  def period_seconds(rules, period) do
    minutes =
      if period <= rules["periods"], do: rules["period_minutes"], else: rules["overtime_minutes"]

    round(minutes * 60)
  end
end
