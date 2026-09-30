#include "GameTheory/NashSolver.h"

namespace
{
	constexpr float Eps = 1e-4f;

	FString CellName(const FIntPoint& C)
	{
		return FString::Printf(TEXT("(%s,%s)"), C.X == 0 ? TEXT("C") : TEXT("D"), C.Y == 0 ? TEXT("C") : TEXT("D"));
	}
}

FNashResult UNashSolver::SolveMatrix(const FPayoffMatrix& M)
{
	// Row index = player action, column index = AI action. 0 = Cooperate, 1 = Defect.
	const float A[2][2] = { { M.CC_Player, M.CD_Player }, { M.DC_Player, M.DD_Player } };
	const float B[2][2] = { { M.CC_AI,     M.CD_AI     }, { M.DC_AI,     M.DD_AI     } };
	return Solve(A, B);
}

FNashResult UNashSolver::Solve(const float A[2][2], const float B[2][2])
{
	FNashResult R;

	// ---------------------------------------------------------------
	// 1) PURE-STRATEGY NASH EQUILIBRIA (best-response check)
	//    Cell (i,j) is a NE if:
	//      - row i is a best response to column j:  A[i][j] >= A[1-i][j]
	//      - column j is a best response to row i:  B[i][j] >= B[i][1-j]
	// ---------------------------------------------------------------
	for (int32 i = 0; i < 2; ++i)
	{
		for (int32 j = 0; j < 2; ++j)
		{
			const bool bRowBest = A[i][j] >= A[1 - i][j] - Eps;
			const bool bColBest = B[i][j] >= B[i][1 - j] - Eps;
			if (bRowBest && bColBest)
			{
				R.PureEquilibria.Add(FIntPoint(i, j));
			}
		}
	}

	// ---------------------------------------------------------------
	// 2) STRICTLY DOMINANT STRATEGIES
	//    Row action 0 dominates if it is better against BOTH column actions.
	// ---------------------------------------------------------------
	if (A[0][0] > A[1][0] + Eps && A[0][1] > A[1][1] + Eps) R.PlayerDominantAction = 0;
	if (A[1][0] > A[0][0] + Eps && A[1][1] > A[0][1] + Eps) R.PlayerDominantAction = 1;
	if (B[0][0] > B[0][1] + Eps && B[1][0] > B[1][1] + Eps) R.AIDominantAction = 0;
	if (B[0][1] > B[0][0] + Eps && B[1][1] > B[1][0] + Eps) R.AIDominantAction = 1;

	// ---------------------------------------------------------------
	// 3) MIXED-STRATEGY EQUILIBRIUM (indifference principle)
	//    Each player mixes so that the OTHER player is indifferent.
	//
	//    Let q = P(column plays 0). Row is indifferent when
	//      q*A00 + (1-q)*A01 = q*A10 + (1-q)*A11
	//      => q = (A11 - A01) / (A00 - A01 - A10 + A11)
	//
	//    Let p = P(row plays 0). Column is indifferent when
	//      p*B00 + (1-p)*B10 = p*B01 + (1-p)*B11
	//      => p = (B11 - B10) / (B00 - B10 - B01 + B11)
	//
	//    A proper mixed NE needs 0 < p < 1 and 0 < q < 1.
	// ---------------------------------------------------------------
	const float DenQ = A[0][0] - A[0][1] - A[1][0] + A[1][1];
	const float DenP = B[0][0] - B[1][0] - B[0][1] + B[1][1];
	if (FMath::Abs(DenQ) > Eps && FMath::Abs(DenP) > Eps)
	{
		const float q = (A[1][1] - A[0][1]) / DenQ;
		const float p = (B[1][1] - B[1][0]) / DenP;
		if (p > Eps && p < 1.f - Eps && q > Eps && q < 1.f - Eps)
		{
			R.bHasMixedEquilibrium = true;
			R.MixedPlayerProbAction0 = p;
			R.MixedAIProbAction0 = q;
			// At equilibrium each player's payoff equals the payoff of either pure action.
			R.MixedPlayerPayoff = q * A[0][0] + (1.f - q) * A[0][1];
			R.MixedAIPayoff = p * B[0][0] + (1.f - p) * B[1][0];
		}
	}

	// ---------------------------------------------------------------
	// 4) PARETO-OPTIMAL CELLS
	//    A cell is Pareto-dominated if another cell is at least as good for
	//    both players and strictly better for at least one.
	// ---------------------------------------------------------------
	for (int32 i = 0; i < 2; ++i)
	{
		for (int32 j = 0; j < 2; ++j)
		{
			bool bDominated = false;
			for (int32 k = 0; k < 2 && !bDominated; ++k)
			{
				for (int32 l = 0; l < 2 && !bDominated; ++l)
				{
					const bool bAtLeast = A[k][l] >= A[i][j] - Eps && B[k][l] >= B[i][j] - Eps;
					const bool bStrict = A[k][l] > A[i][j] + Eps || B[k][l] > B[i][j] + Eps;
					bDominated = bAtLeast && bStrict;
				}
			}
			if (!bDominated)
			{
				R.ParetoOptimal.Add(FIntPoint(i, j));
			}
		}
	}

	// ---------------------------------------------------------------
	// 5) RISK DOMINANCE (only meaningful with two pure NE that differ in both actions)
	//    Deviation loss at NE (i,j) = (A[i][j] - A[1-i][j]) * (B[i][j] - B[i][1-j]).
	//    The equilibrium with the bigger product is "safer" -> risk-dominant.
	// ---------------------------------------------------------------
	if (R.PureEquilibria.Num() == 2)
	{
		const FIntPoint E1 = R.PureEquilibria[0], E2 = R.PureEquilibria[1];
		if (E1.X != E2.X && E1.Y != E2.Y)
		{
			auto Loss = [&](const FIntPoint& E)
			{
				return (A[E.X][E.Y] - A[1 - E.X][E.Y]) * (B[E.X][E.Y] - B[E.X][1 - E.Y]);
			};
			const float L1 = Loss(E1), L2 = Loss(E2);
			if (FMath::Abs(L1 - L2) > Eps)
			{
				R.RiskDominant = L1 > L2 ? E1 : E2;
			}
		}
	}

	// ---------------------------------------------------------------
	// Summary text
	// ---------------------------------------------------------------
	TArray<FString> NE, PO;
	for (const FIntPoint& C : R.PureEquilibria) NE.Add(CellName(C));
	for (const FIntPoint& C : R.ParetoOptimal) PO.Add(CellName(C));

	R.Summary = FString::Printf(TEXT("Pure NE: %s | Pareto: %s"),
		NE.Num() ? *FString::Join(NE, TEXT(" ")) : TEXT("none"),
		*FString::Join(PO, TEXT(" ")));
	if (R.bHasMixedEquilibrium)
	{
		R.Summary += FString::Printf(TEXT(" | Mixed NE: P(player C)=%.3f, P(AI C)=%.3f, payoffs %.2f/%.2f"),
			R.MixedPlayerProbAction0, R.MixedAIProbAction0, R.MixedPlayerPayoff, R.MixedAIPayoff);
	}
	R.Summary += FString::Printf(TEXT(" | Dominant: player=%s, AI=%s"),
		R.PlayerDominantAction < 0 ? TEXT("none") : (R.PlayerDominantAction == 0 ? TEXT("C") : TEXT("D")),
		R.AIDominantAction < 0 ? TEXT("none") : (R.AIDominantAction == 0 ? TEXT("C") : TEXT("D")));
	if (R.RiskDominant.X >= 0)
	{
		R.Summary += FString::Printf(TEXT(" | Risk-dominant: %s"), *CellName(R.RiskDominant));
	}
	return R;
}
