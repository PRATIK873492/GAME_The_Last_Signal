#include "GameTheory/Strategies/Strategies.h"

#define LOCTEXT_NAMESPACE "LastSignalStrategies"

// =====================================================================
// UStrategy (base)
// =====================================================================

bool UStrategy::OpponentEverDefected(const TArray<FRoundRecord>& History)
{
	return History.ContainsByPredicate([](const FRoundRecord& R) { return R.PlayerAction == EGTAction::Defect; });
}

EExtraction UStrategy::ChooseExtraction(const TArray<FRoundRecord>& History, float TrustScore, float RiverHealth) const
{
	// Trusting colonies believe others will hold back too, so they hold back.
	if (TrustScore >= 66.f) return EExtraction::Low;
	if (TrustScore >= 33.f) return EExtraction::Medium;
	return EExtraction::High;
}

// =====================================================================
// Always Cooperate
// =====================================================================

UStrategy_AlwaysCooperate::UStrategy_AlwaysCooperate()
{
	DisplayName = LOCTEXT("AllC", "Always Cooperate");
	Description = LOCTEXT("AllCDesc", "Cooperates every round, no matter what.");
}

EGTAction UStrategy_AlwaysCooperate::ChooseAction(const TArray<FRoundRecord>&, const FPayoffMatrix&, FRandomStream&) const
{
	return EGTAction::Cooperate;
}

EExtraction UStrategy_AlwaysCooperate::ChooseExtraction(const TArray<FRoundRecord>&, float, float) const
{
	return EExtraction::Low;
}

// =====================================================================
// Always Defect
// =====================================================================

UStrategy_AlwaysDefect::UStrategy_AlwaysDefect()
{
	DisplayName = LOCTEXT("AllD", "Always Defect");
	Description = LOCTEXT("AllDDesc", "Defects every round. The Nash strategy of a one-shot Prisoner's Dilemma.");
}

EGTAction UStrategy_AlwaysDefect::ChooseAction(const TArray<FRoundRecord>&, const FPayoffMatrix&, FRandomStream&) const
{
	return EGTAction::Defect;
}

EExtraction UStrategy_AlwaysDefect::ChooseExtraction(const TArray<FRoundRecord>&, float, float) const
{
	return EExtraction::High;
}

// =====================================================================
// Tit-for-Tat
// =====================================================================

UStrategy_TitForTat::UStrategy_TitForTat()
{
	DisplayName = LOCTEXT("TFT", "Tit-for-Tat");
	Description = LOCTEXT("TFTDesc", "Cooperates first, then copies the opponent's last move.");
}

EGTAction UStrategy_TitForTat::ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix&, FRandomStream&) const
{
	// Nice: open with cooperation. Retaliatory + forgiving: mirror the last move.
	return History.Num() == 0 ? EGTAction::Cooperate : History.Last().PlayerAction;
}

// =====================================================================
// Generous Tit-for-Tat
// =====================================================================

UStrategy_GenerousTitForTat::UStrategy_GenerousTitForTat()
{
	DisplayName = LOCTEXT("GTFT", "Generous Tit-for-Tat");
	Description = LOCTEXT("GTFTDesc", "Copies the opponent's last move, but forgives a defection 30% of the time.");
}

EGTAction UStrategy_GenerousTitForTat::ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix&, FRandomStream& Rng) const
{
	if (History.Num() == 0 || History.Last().PlayerAction == EGTAction::Cooperate)
	{
		return EGTAction::Cooperate;
	}
	// Opponent defected last round: forgive with probability Forgiveness.
	// Forgiveness breaks the endless C/D echo that plain TFT falls into after one mistake.
	return Rng.FRand() < Forgiveness ? EGTAction::Cooperate : EGTAction::Defect;
}

// =====================================================================
// Grim Trigger
// =====================================================================

UStrategy_GrimTrigger::UStrategy_GrimTrigger()
{
	DisplayName = LOCTEXT("Grim", "Grim Trigger");
	Description = LOCTEXT("GrimDesc", "Cooperates until the opponent defects once. After that, defects forever.");
}

EGTAction UStrategy_GrimTrigger::ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix&, FRandomStream&) const
{
	// "Cross me once and we're done."
	return OpponentEverDefected(History) ? EGTAction::Defect : EGTAction::Cooperate;
}

EExtraction UStrategy_GrimTrigger::ChooseExtraction(const TArray<FRoundRecord>& History, float TrustScore, float RiverHealth) const
{
	// A betrayed Grim colony no longer cares about the shared river.
	return OpponentEverDefected(History) ? EExtraction::High : EExtraction::Low;
}

float UStrategy_GrimTrigger::GetBaseContribution(const TArray<FRoundRecord>& History) const
{
	// All-or-nothing: full support if never betrayed, zero otherwise.
	return OpponentEverDefected(History) ? 0.f : 100.f;
}

// =====================================================================
// Pavlov (Win-Stay, Lose-Shift)
// =====================================================================

UStrategy_Pavlov::UStrategy_Pavlov()
{
	DisplayName = LOCTEXT("Pavlov", "Pavlov");
	Description = LOCTEXT("PavlovDesc", "Win-Stay, Lose-Shift: repeats its last move if it scored R or T, otherwise switches.");
}

EGTAction UStrategy_Pavlov::ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream&) const
{
	if (History.Num() == 0)
	{
		return EGTAction::Cooperate;
	}
	const FRoundRecord& Last = History.Last();

	// "Win" = our payoff was at least the mutual-cooperation reward R (so R or T in a PD).
	const float Aspiration = Matrix.CC_AI;
	const bool bWon = Last.AIPayoff >= Aspiration - KINDA_SMALL_NUMBER;

	if (bWon)
	{
		return Last.AIAction; // stay
	}
	return Last.AIAction == EGTAction::Cooperate ? EGTAction::Defect : EGTAction::Cooperate; // shift
}

// =====================================================================
// Opportunist
// =====================================================================

UStrategy_Opportunist::UStrategy_Opportunist()
{
	DisplayName = LOCTEXT("Opp", "Opportunist");
	Description = LOCTEXT("OppDesc", "Learns how the opponent reacts and plays whatever maximises its expected payoff.");
}

EGTAction UStrategy_Opportunist::ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& M, FRandomStream&) const
{
	// --- Step 1: learn the player's reaction model --------------------------------
	// PAfter[a] = P(player cooperates this round | Silas played a last round).
	// Laplace smoothing (+1 / +2) gives 0.5 when there is no data yet.
	float Coop[2] = { 0.f, 0.f };
	float Total[2] = { 0.f, 0.f };
	for (int32 k = 1; k < History.Num(); ++k)
	{
		const int32 Prev = static_cast<int32>(History[k - 1].AIAction);
		Total[Prev] += 1.f;
		if (History[k].PlayerAction == EGTAction::Cooperate)
		{
			Coop[Prev] += 1.f;
		}
	}
	const float PAfter[2] = { (Coop[0] + 1.f) / (Total[0] + 2.f), (Coop[1] + 1.f) / (Total[1] + 2.f) };

	// Probability the player cooperates THIS round (predicted from Silas's last move).
	const float PNow = History.Num() == 0 ? 0.5f : PAfter[static_cast<int32>(History.Last().AIAction)];

	// --- Step 2: expected payoffs -------------------------------------------------
	// Immediate expected payoff of Silas's action a if the player cooperates with probability p.
	auto Immediate = [&M](EGTAction A, float P)
	{
		return P * M.GetAIPayoff(EGTAction::Cooperate, A) + (1.f - P) * M.GetAIPayoff(EGTAction::Defect, A);
	};
	auto BestImmediate = [&](float P)
	{
		return FMath::Max(Immediate(EGTAction::Cooperate, P), Immediate(EGTAction::Defect, P));
	};

	// One-step look-ahead: my action now changes how the player treats me next round.
	const float ValueC = Immediate(EGTAction::Cooperate, PNow) + Delta * BestImmediate(PAfter[0]);
	const float ValueD = Immediate(EGTAction::Defect, PNow) + Delta * BestImmediate(PAfter[1]);

	// Ties go to defection: Silas never leaves money on the table.
	return ValueC > ValueD ? EGTAction::Cooperate : EGTAction::Defect;
}

EExtraction UStrategy_Opportunist::ChooseExtraction(const TArray<FRoundRecord>&, float, float RiverHealth) const
{
	// Grabs as much as possible while the river is healthy, eases off only
	// when a dead river (and its penalty) becomes a real risk to Silas himself.
	if (RiverHealth > 60.f) return EExtraction::High;
	if (RiverHealth > 30.f) return EExtraction::Medium;
	return EExtraction::Low;
}

#undef LOCTEXT_NAMESPACE
