#pragma once

#include "CoreMinimal.h"
#include "UObject/Object.h"
#include "GameTheory/GameTheoryTypes.h"
#include "Strategy.generated.h"

/**
 * Base class for every AI strategy.
 *
 * Design rule: strategies are STATELESS. Every decision is computed only from the
 * colony's round history. That is why we can swap a colony's strategy live during
 * the viva (or after loading a save) and it behaves correctly straight away.
 *
 * History is always from the AI's point of view:
 *   Record.PlayerAction = what the opponent did, Record.AIAction = what THIS strategy did.
 */
UCLASS(Abstract, Blueprintable, EditInlineNew)
class LASTSIGNAL_API UStrategy : public UObject
{
	GENERATED_BODY()

public:
	/** Name shown in UI / debug output. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Strategy")
	FText DisplayName;

	/** One-line rule, shown in the Codex and the demo panel. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "Strategy", meta = (MultiLine = true))
	FText Description;

	/** Choose Cooperate or Defect for the next round of a 2x2 game. */
	virtual EGTAction ChooseAction(const TArray<FRoundRecord>& History, const FPayoffMatrix& Matrix, FRandomStream& Rng) const
		PURE_VIRTUAL(UStrategy::ChooseAction, return EGTAction::Cooperate;);

	/**
	 * Chapter 3 (Tragedy of the Commons): how much water to take today.
	 * Default: the more the colony trusts the player, the more it restrains itself.
	 */
	virtual EExtraction ChooseExtraction(const TArray<FRoundRecord>& History, float TrustScore, float RiverHealth) const;

	/**
	 * Chapter 7 (Public Goods): base contribution out of 100 BEFORE trust scaling.
	 * Final contribution = Base * TrustScore / 100.
	 */
	virtual float GetBaseContribution(const TArray<FRoundRecord>& History) const { return 80.f; }

	/** Helper: has the opponent ever defected? */
	static bool OpponentEverDefected(const TArray<FRoundRecord>& History);
};
