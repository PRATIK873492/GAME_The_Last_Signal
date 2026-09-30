#pragma once

#include "CoreMinimal.h"
#include "GameTheory/Strategies/Strategy.h"
#include "Strategies.generated.h"

/** Always plays action 0. The "nice but exploitable" baseline. */
UCLASS(meta = (DisplayName = "Always Cooperate"))
class LASTSIGNAL_API UStrategy_AlwaysCooperate : public UStrategy
{
	GENERATED_BODY()
public:
	UStrategy_AlwaysCooperate();
	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const override;
	virtual EExtraction ChooseExtraction(const TArray<FRoundRecord>& History, float TrustScore, float RiverHealth) const override;
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const override { return 100.f; }
};

/** Always plays action 1. The one-shot Nash strategy of the Prisoner's Dilemma. */
UCLASS(meta = (DisplayName = "Always Defect"))
class LASTSIGNAL_API UStrategy_AlwaysDefect : public UStrategy
{
	GENERATED_BODY()
public:
	UStrategy_AlwaysDefect();
	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const override;
	virtual EExtraction ChooseExtraction(const TArray<FRoundRecord>& History, float TrustScore, float RiverHealth) const override;
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const override { return 0.f; }
};

/** Cooperate first, then copy the opponent's previous move (winner of Axelrod's 1980 tournaments). */
UCLASS(meta = (DisplayName = "Tit-for-Tat"))
class LASTSIGNAL_API UStrategy_TitForTat : public UStrategy
{
	GENERATED_BODY()
public:
	UStrategy_TitForTat();
	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const override;
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const override { return 90.f; }
};

/** Tit-for-Tat that forgives a defection with probability Forgiveness. (Dr. Elena Cruz) */
UCLASS(meta = (DisplayName = "Generous Tit-for-Tat"))
class LASTSIGNAL_API UStrategy_GenerousTitForTat : public UStrategy
{
	GENERATED_BODY()
public:
	UStrategy_GenerousTitForTat();

	/** Probability of cooperating anyway after the opponent defected. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Strategy", meta = (ClampMin = "0", ClampMax = "1"))
	float Forgiveness = 0.3f;

	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const override;
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const override { return 95.f; }
};

/** Cooperate until the opponent defects once, then defect forever. (Rhea "Iron" Dutta) */
UCLASS(meta = (DisplayName = "Grim Trigger"))
class LASTSIGNAL_API UStrategy_GrimTrigger : public UStrategy
{
	GENERATED_BODY()
public:
	UStrategy_GrimTrigger();
	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const override;
	virtual EExtraction ChooseExtraction(const TArray<FRoundRecord>& History, float TrustScore, float RiverHealth) const override;
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const override;
};

/**
 * Win-Stay, Lose-Shift. If last round's payoff reached the mutual-cooperation reward R
 * (i.e. we got R or T) repeat the last move, otherwise switch.
 */
UCLASS(meta = (DisplayName = "Pavlov (Win-Stay, Lose-Shift)"))
class LASTSIGNAL_API UStrategy_Pavlov : public UStrategy
{
	GENERATED_BODY()
public:
	UStrategy_Pavlov();
	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const override;
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const override { return 85.f; }
};

/**
 * Best-responds to a learned model of the player. (Silas Crow)
 *
 * It estimates, from history, how likely the player is to cooperate
 * after Silas cooperated vs. after Silas defected (i.e. "does this player retaliate?").
 * Then it scores each action as:
 *
 *   Value(a) = ImmediateEV(a, p_now) + Delta * BestImmediateEV(p_next(a))
 *
 * - Against a push-over (always cooperates) -> defecting is best -> Silas exploits.
 * - Against a retaliator (Tit-for-Tat)      -> defecting ruins next round -> Silas cooperates.
 */
UCLASS(meta = (DisplayName = "Opportunist"))
class LASTSIGNAL_API UStrategy_Opportunist : public UStrategy
{
	GENERATED_BODY()
public:
	UStrategy_Opportunist();

	/** How much Silas values the next round relative to this one (the "shadow of the future"). */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Strategy", meta = (ClampMin = "0", ClampMax = "1"))
	float Delta = 0.9f;

	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const override;
	virtual EExtraction ChooseExtraction(const TArray<FRoundRecord>& History, float TrustScore, float RiverHealth) const override;
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const override { return 70.f; }
};
