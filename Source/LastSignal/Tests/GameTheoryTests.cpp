// Automated proof that the math is correct.
// Run: Tools -> Session Frontend -> Automation -> filter "LastSignal" -> Start Tests.
// Show this in the viva: every number in the Payoff Matrix UI is backed by a passing test.

#include "Misc/AutomationTest.h"
#include "GameTheory/NashSolver.h"
#include "GameTheory/GameTheorySubsystem.h"
#include "GameTheory/Strategies/Strategies.h"

#if WITH_DEV_AUTOMATION_TESTS

namespace
{
	FPayoffMatrix Make(float CCp, float CCa, float CDp, float CDa, float DCp, float DCa, float DDp, float DDa)
	{
		FPayoffMatrix M;
		M.CC_Player = CCp; M.CC_AI = CCa; M.CD_Player = CDp; M.CD_AI = CDa;
		M.DC_Player = DCp; M.DC_AI = DCa; M.DD_Player = DDp; M.DD_AI = DDa;
		return M;
	}

	FRoundRecord Round(EGTAction Player, EGTAction AI, const FPayoffMatrix& M)
	{
		FRoundRecord R;
		R.PlayerAction = Player; R.AIAction = AI;
		R.PlayerPayoff = M.GetPlayerPayoff(Player, AI); R.AIPayoff = M.GetAIPayoff(Player, AI);
		return R;
	}

	constexpr EGTAction C = EGTAction::Cooperate;
	constexpr EGTAction D = EGTAction::Defect;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FNashSolverTest, "LastSignal.GameTheory.NashSolver",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::EngineFilter)

bool FNashSolverTest::RunTest(const FString&)
{
	// ---- Prisoner's Dilemma: only (D,D), both have D dominant, (D,D) is NOT Pareto-optimal
	{
		const FPayoffMatrix PD; // defaults T5 R3 P1 S0
		TestTrue(TEXT("PD satisfies T>R>P>S and 2R>T+S"), PD.IsPrisonersDilemma());
		const FNashResult R = UNashSolver::SolveMatrix(PD);
		TestEqual(TEXT("PD: one pure NE"), R.PureEquilibria.Num(), 1);
		TestTrue(TEXT("PD: NE is (D,D)"), R.PureEquilibria.Contains(FIntPoint(1, 1)));
		TestEqual(TEXT("PD: player dominant = D"), R.PlayerDominantAction, 1);
		TestEqual(TEXT("PD: AI dominant = D"), R.AIDominantAction, 1);
		TestFalse(TEXT("PD: no mixed NE"), R.bHasMixedEquilibrium);
		TestFalse(TEXT("PD: (D,D) is Pareto-dominated by (C,C)"), R.ParetoOptimal.Contains(FIntPoint(1, 1)));
		TestTrue(TEXT("PD: (C,C) is Pareto-optimal"), R.ParetoOptimal.Contains(FIntPoint(0, 0)));
	}

	// ---- Chicken: two pure NE (Swerve,Stay) and (Stay,Swerve); mixed p = q = 1/3
	{
		const FNashResult R = UNashSolver::SolveMatrix(Make(3, 3, 1, 5, 5, 1, 0, 0));
		TestEqual(TEXT("Chicken: two pure NE"), R.PureEquilibria.Num(), 2);
		TestTrue(TEXT("Chicken: (Swerve,Stay)"), R.PureEquilibria.Contains(FIntPoint(0, 1)));
		TestTrue(TEXT("Chicken: (Stay,Swerve)"), R.PureEquilibria.Contains(FIntPoint(1, 0)));
		TestTrue(TEXT("Chicken: mixed exists"), R.bHasMixedEquilibrium);
		TestEqual(TEXT("Chicken: P(player swerves) = 1/3"), R.MixedPlayerProbAction0, 1.f / 3.f, 1e-3f);
		TestEqual(TEXT("Chicken: P(AI swerves) = 1/3"), R.MixedAIProbAction0, 1.f / 3.f, 1e-3f);
		TestEqual(TEXT("Chicken: no dominant strategy"), R.PlayerDominantAction, -1);
	}

	// ---- Stag Hunt: (Stag,Stag) payoff-dominant, (Hare,Hare) risk-dominant, mixed 0.6
	{
		const FNashResult R = UNashSolver::SolveMatrix(Make(5, 5, 0, 3, 3, 0, 3, 3));
		TestEqual(TEXT("Stag: two pure NE"), R.PureEquilibria.Num(), 2);
		TestTrue(TEXT("Stag: (Stag,Stag)"), R.PureEquilibria.Contains(FIntPoint(0, 0)));
		TestTrue(TEXT("Stag: (Hare,Hare)"), R.PureEquilibria.Contains(FIntPoint(1, 1)));
		TestEqual(TEXT("Stag: only (Stag,Stag) Pareto-optimal"), R.ParetoOptimal.Num(), 1);
		TestTrue(TEXT("Stag: (Hare,Hare) risk-dominant"), R.RiskDominant == FIntPoint(1, 1));
		TestEqual(TEXT("Stag: need 60% belief partner hunts stag"), R.MixedAIProbAction0, 0.6f, 1e-3f);
	}

	// ---- Matching Pennies: no pure NE, 50/50 mixed
	{
		const FNashResult R = UNashSolver::SolveMatrix(Make(1, -1, -1, 1, -1, 1, 1, -1));
		TestEqual(TEXT("Pennies: no pure NE"), R.PureEquilibria.Num(), 0);
		TestTrue(TEXT("Pennies: mixed exists"), R.bHasMixedEquilibrium);
		TestEqual(TEXT("Pennies: 50/50"), R.MixedPlayerProbAction0, 0.5f, 1e-3f);
	}
	return true;
}

IMPLEMENT_SIMPLE_AUTOMATION_TEST(FStrategyTest, "LastSignal.GameTheory.Strategies",
	EAutomationTestFlags::EditorContext | EAutomationTestFlags::ClientContext | EAutomationTestFlags::EngineFilter)

bool FStrategyTest::RunTest(const FString&)
{
	const FPayoffMatrix PD;
	FRandomStream Rng(42);
	const UStrategy* TFT = GetDefault<UStrategy_TitForTat>();
	const UStrategy* Grim = GetDefault<UStrategy_GrimTrigger>();
	const UStrategy* Pavlov = GetDefault<UStrategy_Pavlov>();
	const UStrategy* Opp = GetDefault<UStrategy_Opportunist>();

	TArray<FRoundRecord> H;
	TestTrue(TEXT("TFT opens with C"), TFT->ChooseAction(H, PD, Rng) == C);
	TestTrue(TEXT("Grim opens with C"), Grim->ChooseAction(H, PD, Rng) == C);

	H.Add(Round(D, C, PD));
	TestTrue(TEXT("TFT copies D"), TFT->ChooseAction(H, PD, Rng) == D);
	H.Add(Round(C, D, PD));
	H.Add(Round(C, C, PD));
	TestTrue(TEXT("TFT forgives after C"), TFT->ChooseAction(H, PD, Rng) == C);
	TestTrue(TEXT("Grim never forgives"), Grim->ChooseAction(H, PD, Rng) == D);

	// Pavlov: got S (0) after (player D, AI C) -> lose -> shift to D
	TArray<FRoundRecord> P1 = { Round(D, C, PD) };
	TestTrue(TEXT("Pavlov lose-shift"), Pavlov->ChooseAction(P1, PD, Rng) == D);
	// got T (5) after (player C, AI D) -> win -> stay D
	TArray<FRoundRecord> P2 = { Round(C, D, PD) };
	TestTrue(TEXT("Pavlov win-stay"), Pavlov->ChooseAction(P2, PD, Rng) == D);
	// got P (1) after (D,D) -> lose -> shift to C
	TArray<FRoundRecord> P3 = { Round(D, D, PD) };
	TestTrue(TEXT("Pavlov shifts out of mutual defection"), Pavlov->ChooseAction(P3, PD, Rng) == C);

	// Opportunist exploits an unconditional cooperator...
	TArray<FRoundRecord> Sucker;
	for (int32 i = 0; i < 10; ++i) Sucker.Add(Round(C, i % 2 ? D : C, PD));
	TestTrue(TEXT("Opportunist exploits AllC"), Opp->ChooseAction(Sucker, PD, Rng) == D);

	// ...but cooperates with a Tit-for-Tat player (player copies Silas's previous move).
	TArray<FRoundRecord> Retaliator;
	EGTAction PrevAI = C;
	for (int32 i = 0; i < 10; ++i)
	{
		const EGTAction AI = (i == 3 || i == 6) ? D : C; // Silas tested the player twice
		Retaliator.Add(Round(PrevAI, AI, PD));
		PrevAI = AI;
	}
	TestTrue(TEXT("Opportunist cooperates with a retaliator"), Opp->ChooseAction(Retaliator, PD, Rng) == C);

	// Trust: all-cooperate history -> high, recent defection -> drops sharply
	TArray<FRoundRecord> Good;
	for (int32 i = 0; i < 5; ++i) Good.Add(Round(C, C, PD));
	const float TGood = UGameTheorySubsystem::ComputeTrust(Good, 0.8f, 50.f);
	Good.Add(Round(D, C, PD));
	const float TAfter = UGameTheorySubsystem::ComputeTrust(Good, 0.8f, 50.f);
	TestTrue(TEXT("Trust high after cooperation"), TGood > 80.f);
	TestTrue(TEXT("Recent defection weighs heavily"), TAfter < TGood - 15.f);
	return true;
}

#endif // WITH_DEV_AUTOMATION_TESTS
