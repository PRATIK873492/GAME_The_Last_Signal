#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "GameTheory/GameTheoryTypes.h"
#include "NashSolver.generated.h"

/**
 * Everything the Payoff Matrix UI needs to know about a 2x2 game.
 * Cells are FIntPoint(X = player/row action index, Y = AI/column action index).
 */
USTRUCT(BlueprintType)
struct FNashResult
{
	GENERATED_BODY()

	/** Cells where neither player can gain by changing only their own action. */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") TArray<FIntPoint> PureEquilibria;

	/** True if a fully mixed equilibrium exists (both players randomise strictly between 0 and 1). */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") bool bHasMixedEquilibrium = false;

	/** In the mixed equilibrium: probability the PLAYER (row) plays action 0. */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") float MixedPlayerProbAction0 = 0.f;

	/** In the mixed equilibrium: probability the AI (column) plays action 0. */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") float MixedAIProbAction0 = 0.f;

	/** Expected payoffs in the mixed equilibrium. */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") float MixedPlayerPayoff = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Nash") float MixedAIPayoff = 0.f;

	/** Strictly dominant action for each side, or -1 if none. */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") int32 PlayerDominantAction = -1;
	UPROPERTY(BlueprintReadOnly, Category = "Nash") int32 AIDominantAction = -1;

	/** Cells that no other cell makes someone better off without making someone worse off. */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") TArray<FIntPoint> ParetoOptimal;

	/**
	 * When there are exactly two pure equilibria (Stag Hunt, Chicken), the one with the larger
	 * product of deviation losses is risk-dominant (Harsanyi & Selten). (-1,-1) if not applicable.
	 */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") FIntPoint RiskDominant = FIntPoint(-1, -1);

	/** Human-readable summary (used by the debug console and as a UI fallback). */
	UPROPERTY(BlueprintReadOnly, Category = "Nash") FString Summary;
};

/**
 * Solves any 2x2 bimatrix game.
 * Row player = the player (Veer), Column player = the AI colony.
 */
UCLASS()
class LASTSIGNAL_API UNashSolver : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Solve a payoff matrix from a Data Table row. */
	UFUNCTION(BlueprintPure, Category = "GameTheory|Nash")
	static FNashResult SolveMatrix(const FPayoffMatrix& Matrix);

	/**
	 * Core solver.
	 * A[i][j] = row player's payoff, B[i][j] = column player's payoff,
	 * where i = row action and j = column action.
	 */
	static FNashResult Solve(const float A[2][2], const float B[2][2]);
};
