# Basketball rules for the game presets

The game rules presets in `web/src/lib/ui/basketball.ts`, and the default in
`Courtside.Basketball` and `web/src/lib/sync/basketball.ts`, come from here.
Checked 2026-11-09.

## Primary source

The NCAA's [2025-26 NCAA/NFHS Major Basketball Rules Differences](https://a-us.storyblok.com/f/1022696/x/aa2311ef81/2025-26-mbb_wbb_nfhs_major_rules_differences-final.pdf),
a joint NCAA/NFHS table comparing high school, NCAA men's and NCAA women's rules. The
NFHS rule book itself is sold, not published.

| | NFHS | NCAA men | NCAA women |
|---|---|---|---|
| Length | Four 8-minute quarters | 20-minute halves | Four 10-minute quarters |
| Overtime | 4 minutes | 5 minutes | 5 minutes |
| One-and-one | None | From the 7th team foul | None |
| Two shots | From the 5th team foul | From the 10th team foul | From the 5th team foul |
| Team fouls reset | End of the 1st, 2nd and 3rd quarters | End of the first half | Same as NFHS |
| Disqualification | 5th foul (personal and technical) | 5th foul (personal and Class A technical) | Same as NFHS, Flagrant 1 included |
| Ejection | 2nd technical, or a flagrant foul | 2nd Class A technical, or a Flagrant 2 | 2nd technical, or a Flagrant 2 |
| Free throws on a team-control (offensive) foul | Never | Only in the bonus after a loose-ball foul | Never |
| Technicals count toward team fouls | Yes | Class A only | Yes (not administrative) |

The NFHS change to the bonus took effect in 2023-24
([NFHS: 2023-24 rules changes](https://nfhs.org/resources/sports/basketball-rules-changes-2023-24),
rule 4-8-1). Before that, high schools played a one-and-one from the 7th team foul in a
half and two shots from the 10th, which is the "before 2023-24" preset.

## How Courtside models them

- **The reset never applies going into overtime.** NFHS and NCAA women reset after
  quarters 1-3 only, NCAA men after the first half only, so overtime continues the last
  regulation quarter or half. `foulPeriodOf` does this for every preset; it's not a
  setting.
- **Every foul type counts toward team fouls and fouling out.** That matches NFHS and
  NCAA women. NCAA men's Class B and administrative technicals don't, but Courtside
  doesn't record technical classes.
- **Ejection** is two technicals or one flagrant foul. Courtside has one flagrant type;
  NCAA's Flagrant 1 (not an ejection) would be recorded as a personal foul.
- **Free throws aren't derived from fouls.** The bonus indicator says what the next
  common foul earns; the free throws themselves are recorded as plays.
- **State associations can differ** (the shot clock is a state option, for example),
  and JV or middle school games often use shorter quarters: use custom rules.
