#include "GameTheory/GameTheorySubsystem.h"
#include "GameTheory/LastSignalSettings.h"
#include "GameTheory/LastSignalSaveGame.h"
#include "GameTheory/Strategies/Strategies.h"
#include "LastSignal.h"
#include "Engine/DataTable.h"
#include "Engine/Engine.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "UObject/UObjectIterator.h"

namespace
{
	/**
	 * Built-in matrices so the engine works before any Data Table is imported.
	 * Data Table rows with the same name override these.
	 * Argument order: CC(player,ai), CD(player,ai), DC(player,ai), DD(player,ai).
	 */
	FPayoffMatrix MakeMatrix(const TCHAR* Name, const TCHAR* A0, const TCHAR* A1, const TCHAR* Explain,
		float CCp, float CCa, float CDp, float CDa, float DCp, float DCa, float DDp, float DDa)
	{
		FPayoffMatrix M;
		M.GameName = FText::FromString(Name);
		M.Action0Label = FText::FromString(A0);
		M.Action1Label = FText::FromString(A1);
		M.Explanation = FText::FromString(Explain);
		M.CC_Player = CCp; M.CC_AI = CCa; M.CD_Player = CDp; M.CD_AI = CDa;
		M.DC_Player = DCp; M.DC_AI = DCa; M.DD_Player = DDp; M.DD_AI = DDa;
		return M;
	}

	bool GetBuiltInMatrix(FName Row, FPayoffMatrix& Out)
	{
		if (Row == TEXT("PD_OneShot") || Row == TEXT("PD_Repeated") || Row == TEXT("PD"))
		{
			Out = MakeMatrix(TEXT("Prisoner's Dilemma"), TEXT("Send Full Shipment"), TEXT("Send Fake Shipment"),
				TEXT("Defecting is better whatever the other side does, so both defect - even though both cooperating pays more."),
				3, 3, 0, 5, 5, 0, 1, 1);
			return true;
		}
		if (Row == TEXT("Chicken"))
		{
			Out = MakeMatrix(TEXT("Game of Chicken"), TEXT("Swerve"), TEXT("Stay"),
				TEXT("Two stable outcomes: one side swerves, the other stays. The danger is both staying."),
				3, 3, 1, 5, 5, 1, 0, 0);
			return true;
		}
		if (Row == TEXT("StagHunt") || Row == TEXT("Stag"))
		{
			Out = MakeMatrix(TEXT("Stag Hunt"), TEXT("Go for the Core"), TEXT("Grab Supplies"),
				TEXT("Hunting the stag together pays most, but grabbing the hare is safe no matter what your partner does."),
				5, 5, 0, 3, 3, 0, 3, 3);
			return true;
		}
		if (Row == TEXT("Pennies"))
		{
			Out = MakeMatrix(TEXT("Matching Pennies"), TEXT("Heads"), TEXT("Tails"),
				TEXT("Zero-sum: no pure equilibrium, both players must randomise 50/50."),
				1, -1, -1, 1, -1, 1, 1, -1);
			return true;
		}
		return false;
	}

	FString ActionChar(EGTAction A) { return A == EGTAction::Cooperate ? TEXT("C") : TEXT("D"); }

	FString ColonyName(EColony C) { return StaticEnum<EColony>()->GetNameStringByValue(static_cast<int64>(C)); }

	FString StrategyName(const UStrategy* S) { return S ? S->DisplayName.ToString() : TEXT("<none>"); }
}

// =====================================================================
// Lifecycle
// =====================================================================

void UGameTheorySubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	const ULastSignalSettings* Settings = GetDefault<ULastSignalSettings>();
	if (Settings->RandomSeed != 0)
	{
		Rng.Initialize(Settings->RandomSeed);
	}
	else
	{
		Rng.GenerateNewSeed();
	}

	ResetAll();
	RegisterConsoleCommands();
	UE_LOG(LogGameTheory, Log, TEXT("GameTheorySubsystem ready. Type 'LS.' in the console for debug commands."));
}

void UGameTheorySubsystem::Deinitialize()
{
	for (IConsoleObject* Cmd : ConsoleCommands)
	{
		IConsoleManager::Get().UnregisterConsoleObject(Cmd);
	}
	ConsoleCommands.Empty();
	Super::Deinitialize();
}

const TArray<EColony>& UGameTheorySubsystem::AIColonies()
{
	static const TArray<EColony> List = { EColony::Ironside, EColony::Mercy, EColony::Crows };
	return List;
}

void UGameTheorySubsystem::ResetAll()
{
	const ULastSignalSettings* Settings = GetDefault<ULastSignalSettings>();

	Histories.Empty();
	ResourceScore.Empty();
	Strategies.Empty();

	for (EColony C : AIColonies())
	{
		Histories.Add(C);
		const TSubclassOf<UStrategy>* Class = Settings->ColonyStrategies.Find(C);
		SetColonyStrategy(C, Class && *Class ? *Class : TSubclassOf<UStrategy>(UStrategy_TitForTat::StaticClass()));
	}
	for (EColony C : { EColony::Lakeside, EColony::Ironside, EColony::Mercy, EColony::Crows })
	{
		ResourceScore.Add(C, 0.f);
	}

	RiverHealth = Settings->RiverStartHealth;
	bRiverDead = false;
	CommonsDay = 0;
}

// =====================================================================
// 2x2 games
// =====================================================================

FPayoffMatrix UGameTheorySubsystem::GetPayoffMatrix(FName RowName) const
{
	// 1) Data Table (designer-editable)
	if (UDataTable* Table = GetDefault<ULastSignalSettings>()->PayoffTable.LoadSynchronous())
	{
		if (const FPayoffMatrix* Row = Table->FindRow<FPayoffMatrix>(RowName, TEXT("GetPayoffMatrix"), false))
		{
			return *Row;
		}
	}
	// 2) Built-in presets, 3) standard Prisoner's Dilemma
	FPayoffMatrix M;
	GetBuiltInMatrix(RowName, M);
	return M;
}

FNashResult UGameTheorySubsystem::SolvePayoffMatrix(FName RowName) const
{
	return UNashSolver::SolveMatrix(GetPayoffMatrix(RowName));
}

FRoundRecord UGameTheorySubsystem::PlayRound(EColony Colony, EGTAction PlayerAction, FName MatrixRow, int32 Chapter)
{
	FRoundRecord Record;
	UStrategy* Strategy = GetColonyStrategy(Colony);
	if (!Strategy)
	{
		UE_LOG(LogGameTheory, Warning, TEXT("PlayRound: %s has no strategy (the player's own colony cannot be an opponent)."), *ColonyName(Colony));
		return Record;
	}

	const FPayoffMatrix Matrix = GetPayoffMatrix(MatrixRow);
	FColonyHistory& History = Histories.FindOrAdd(Colony);

	// Simultaneous move: the AI decides using ONLY past rounds, never the player's current choice.
	const EGTAction AIAction = Strategy->ChooseAction(History.Rounds, Matrix, Rng);

	Record.PlayerAction = PlayerAction;
	Record.AIAction = AIAction;
	Record.PlayerPayoff = Matrix.GetPlayerPayoff(PlayerAction, AIAction);
	Record.AIPayoff = Matrix.GetAIPayoff(PlayerAction, AIAction);
	Record.Chapter = Chapter;
	History.Rounds.Add(Record);

	UE_LOG(LogGameTheory, Log, TEXT("[%s | %s] Player=%s AI=%s -> payoffs %.1f / %.1f, trust now %.1f"),
		*ColonyName(Colony), *Matrix.GameName.ToString(), *ActionChar(PlayerAction), *ActionChar(AIAction),
		Record.PlayerPayoff, Record.AIPayoff, GetTrustScore(Colony));

	OnRoundResolved.Broadcast(Colony, Record);
	OnTrustChanged.Broadcast(Colony, GetTrustScore(Colony));
	return Record;
}

// =====================================================================
// Trust
// =====================================================================

float UGameTheorySubsystem::ComputeTrust(const TArray<FRoundRecord>& Rounds, float Decay, float Initial)
{
	// Weighted average of "did the player cooperate?" (1 or 0).
	// Newest round has weight 1, the one before Decay, then Decay^2, ...
	// The initial trust acts as one extra, oldest "phantom" round so a single
	// round does not instantly swing trust to 0 or 100.
	const int32 N = Rounds.Num();
	float WeightSum = FMath::Pow(Decay, static_cast<float>(N));
	float Score = WeightSum * (Initial / 100.f);

	for (int32 k = 0; k < N; ++k)
	{
		const float W = FMath::Pow(Decay, static_cast<float>(N - 1 - k));
		WeightSum += W;
		Score += W * (Rounds[k].PlayerAction == EGTAction::Cooperate ? 1.f : 0.f);
	}
	return WeightSum > 0.f ? 100.f * Score / WeightSum : Initial;
}

float UGameTheorySubsystem::GetTrustScore(EColony Colony) const
{
	const ULastSignalSettings* S = GetDefault<ULastSignalSettings>();
	const FColonyHistory* H = Histories.Find(Colony);
	return ComputeTrust(H ? H->Rounds : TArray<FRoundRecord>(), S->TrustRecencyDecay, S->InitialTrust);
}

int32 UGameTheorySubsystem::GetHostilityLevel(EColony Colony) const
{
	// A triggered Grim colony is at war with the player forever.
	const UStrategy* Strategy = GetColonyStrategy(Colony);
	const FColonyHistory* H = Histories.Find(Colony);
	if (Strategy && Strategy->IsA<UStrategy_GrimTrigger>() && H && UStrategy::OpponentEverDefected(H->Rounds))
	{
		return 5;
	}
	// Otherwise: no stars at trust >= 50, one star per 10 points below that.
	const float Trust = GetTrustScore(Colony);
	return FMath::Clamp(FMath::CeilToInt((50.f - Trust) / 10.f), 0, 5);
}

TArray<FRoundRecord> UGameTheorySubsystem::GetHistory(EColony Colony) const
{
	const FColonyHistory* H = Histories.Find(Colony);
	return H ? H->Rounds : TArray<FRoundRecord>();
}

float UGameTheorySubsystem::GetPlayerCooperationRate() const
{
	int32 Total = 0, Coop = 0;
	for (const TPair<EColony, FColonyHistory>& Pair : Histories)
	{
		for (const FRoundRecord& R : Pair.Value.Rounds)
		{
			++Total;
			Coop += R.PlayerAction == EGTAction::Cooperate ? 1 : 0;
		}
	}
	return Total > 0 ? static_cast<float>(Coop) / Total : 0.f;
}

// =====================================================================
// Strategies
// =====================================================================

void UGameTheorySubsystem::SetColonyStrategy(EColony Colony, TSubclassOf<UStrategy> StrategyClass)
{
	if (Colony == EColony::Lakeside || !StrategyClass || StrategyClass->HasAnyClassFlags(CLASS_Abstract))
	{
		return;
	}
	// Because strategies are stateless, the new one immediately "reads" the existing history.
	Strategies.Add(Colony, NewObject<UStrategy>(this, StrategyClass));
}

UStrategy* UGameTheorySubsystem::GetColonyStrategy(EColony Colony) const
{
	const TObjectPtr<UStrategy>* Found = Strategies.Find(Colony);
	return Found ? Found->Get() : nullptr;
}

// =====================================================================
// Tragedy of the Commons
// =====================================================================

float UGameTheorySubsystem::GetExtractionAmount(EExtraction Level) const
{
	const ULastSignalSettings* S = GetDefault<ULastSignalSettings>();
	switch (Level)
	{
	case EExtraction::Low:    return S->ExtractLow;
	case EExtraction::Medium: return S->ExtractMedium;
	default:                  return S->ExtractHigh;
	}
}

FCommonsDayResult UGameTheorySubsystem::RunCommonsDay(EExtraction PlayerChoice)
{
	const ULastSignalSettings* S = GetDefault<ULastSignalSettings>();
	FCommonsDayResult Result;
	Result.Day = ++CommonsDay;
	Result.HealthBefore = RiverHealth;

	if (bRiverDead)
	{
		// A dead river gives nothing to anyone.
		Result.HealthAfter = 0.f;
		return Result;
	}

	// Everyone chooses at the same time, AI colonies based on strategy + trust.
	Result.Choices.Add(EColony::Lakeside, PlayerChoice);
	for (EColony C : AIColonies())
	{
		const UStrategy* Strategy = GetColonyStrategy(C);
		const EExtraction Choice = Strategy
			? Strategy->ChooseExtraction(GetHistory(C), GetTrustScore(C), RiverHealth)
			: EExtraction::Medium;
		Result.Choices.Add(C, Choice);
	}

	// Individual gain: each colony keeps exactly what it extracts.
	for (const TPair<EColony, EExtraction>& Pair : Result.Choices)
	{
		const float Amount = GetExtractionAmount(Pair.Value);
		Result.Gains.Add(Pair.Key, Amount);
		Result.TotalExtraction += Amount;
		ResourceScore.FindOrAdd(Pair.Key) += Amount;
	}

	// Collective cost: the river regenerates a fixed amount; anything above that is lost health.
	RiverHealth = FMath::Min(S->RiverStartHealth, RiverHealth + S->RiverRegenPerDay - Result.TotalExtraction);
	if (RiverHealth <= 0.f)
	{
		RiverHealth = 0.f;
		bRiverDead = true;
		Result.bRiverDiedToday = true;
		for (TPair<EColony, float>& Pair : ResourceScore)
		{
			Pair.Value -= S->RiverDeathPenalty; // everyone pays, including the restrained colonies
		}
	}

	Result.HealthAfter = RiverHealth;
	Result.CollectiveLoss = Result.HealthBefore - Result.HealthAfter;
	return Result;
}

// =====================================================================
// Public Goods
// =====================================================================

float UGameTheorySubsystem::GetAIContribution(EColony Colony) const
{
	const UStrategy* Strategy = GetColonyStrategy(Colony);
	if (!Strategy)
	{
		return 0.f;
	}
	// Contribution = base (how cooperative the strategy is) x trust (how it feels about the player).
	const float Base = Strategy->GetBaseContribution(GetHistory(Colony));
	return FMath::Clamp(Base * GetTrustScore(Colony) / 100.f, 0.f, GetDefault<ULastSignalSettings>()->Endowment);
}

FPublicGoodsResult UGameTheorySubsystem::RunPublicGoods(float PlayerContribution)
{
	const ULastSignalSettings* S = GetDefault<ULastSignalSettings>();
	FPublicGoodsResult Result;
	Result.Threshold = S->RestartThreshold;

	Result.Contributions.Add(EColony::Lakeside, FMath::Clamp(PlayerContribution, 0.f, S->Endowment));
	for (EColony C : AIColonies())
	{
		Result.Contributions.Add(C, GetAIContribution(C));
	}
	for (const TPair<EColony, float>& Pair : Result.Contributions)
	{
		Result.TotalContribution += Pair.Value;
	}

	Result.bGridRestarted = Result.TotalContribution >= S->RestartThreshold;

	// Everyone gets the grid if it restarts, even those who gave little: the free-rider temptation.
	for (const TPair<EColony, float>& Pair : Result.Contributions)
	{
		const float Payoff = (S->Endowment - Pair.Value) + (Result.bGridRestarted ? S->GridBenefit : 0.f);
		Result.Payoffs.Add(Pair.Key, Payoff);
		ResourceScore.FindOrAdd(Pair.Key) += Payoff;
	}
	return Result;
}

// =====================================================================
// Save / Load
// =====================================================================

bool UGameTheorySubsystem::SaveProgress(const FString& SlotName)
{
	ULastSignalSaveGame* Save = Cast<ULastSignalSaveGame>(UGameplayStatics::CreateSaveGameObject(ULastSignalSaveGame::StaticClass()));
	Save->Histories = Histories;
	Save->ResourceScore = ResourceScore;
	Save->RiverHealth = RiverHealth;
	Save->bRiverDead = bRiverDead;
	Save->CommonsDay = CommonsDay;
	for (const TPair<EColony, TObjectPtr<UStrategy>>& Pair : Strategies)
	{
		Save->Strategies.Add(Pair.Key, FSoftClassPath(Pair.Value->GetClass()));
	}
	return UGameplayStatics::SaveGameToSlot(Save, SlotName, 0);
}

bool UGameTheorySubsystem::LoadProgress(const FString& SlotName)
{
	ULastSignalSaveGame* Save = Cast<ULastSignalSaveGame>(UGameplayStatics::LoadGameFromSlot(SlotName, 0));
	if (!Save)
	{
		return false;
	}
	Histories = Save->Histories;
	ResourceScore = Save->ResourceScore;
	RiverHealth = Save->RiverHealth;
	bRiverDead = Save->bRiverDead;
	CommonsDay = Save->CommonsDay;
	for (const TPair<EColony, FSoftClassPath>& Pair : Save->Strategies)
	{
		if (UClass* Class = Pair.Value.TryLoadClass<UStrategy>())
		{
			SetColonyStrategy(Pair.Key, Class);
		}
	}
	for (EColony C : AIColonies())
	{
		OnTrustChanged.Broadcast(C, GetTrustScore(C));
	}
	return true;
}

// =====================================================================
// Axelrod-style tournament (viva demo)
// =====================================================================

void UGameTheorySubsystem::RunTournament(int32 RoundsPerMatch)
{
	const TArray<UClass*> Classes = GetAllStrategyClasses();
	const FPayoffMatrix PD = GetPayoffMatrix(TEXT("PD_Repeated"));

	TArray<UStrategy*> Players;
	for (UClass* C : Classes)
	{
		Players.Add(NewObject<UStrategy>(GetTransientPackage(), C));
	}
	TArray<float> TotalScore;
	TotalScore.SetNumZeroed(Players.Num());

	// Round-robin: every strategy meets every other strategy and a copy of itself.
	for (int32 i = 0; i < Players.Num(); ++i)
	{
		for (int32 j = i; j < Players.Num(); ++j)
		{
			// Each side sees the match from its own point of view ("PlayerAction" = the opponent).
			TArray<FRoundRecord> HistI, HistJ;
			float ScoreI = 0.f, ScoreJ = 0.f;
			for (int32 r = 0; r < RoundsPerMatch; ++r)
			{
				const EGTAction AI = Players[i]->ChooseAction(HistI, PD, Rng);
				const EGTAction AJ = Players[j]->ChooseAction(HistJ, PD, Rng);
				const float PayI = PD.GetAIPayoff(AJ, AI); // i is the "AI" in its own history
				const float PayJ = PD.GetAIPayoff(AI, AJ);
				ScoreI += PayI;
				ScoreJ += PayJ;

				FRoundRecord RI; RI.PlayerAction = AJ; RI.AIAction = AI; RI.AIPayoff = PayI; RI.PlayerPayoff = PayJ;
				FRoundRecord RJ; RJ.PlayerAction = AI; RJ.AIAction = AJ; RJ.AIPayoff = PayJ; RJ.PlayerPayoff = PayI;
				HistI.Add(RI);
				HistJ.Add(RJ);
			}
			TotalScore[i] += ScoreI;
			if (i != j)
			{
				TotalScore[j] += ScoreJ;
			}
			Print(FString::Printf(TEXT("  %-22s vs %-22s  %6.0f : %-6.0f"),
				*StrategyName(Players[i]), *StrategyName(Players[j]), ScoreI, ScoreJ), FColor::White);
		}
	}

	// Rank by total score (average per round per opponent shown for readability).
	TArray<int32> Order;
	for (int32 i = 0; i < Players.Num(); ++i) Order.Add(i);
	Order.Sort([&](int32 A, int32 B) { return TotalScore[A] > TotalScore[B]; });

	Print(FString::Printf(TEXT("=== TOURNAMENT RESULTS (%d rounds per match) ==="), RoundsPerMatch), FColor::Yellow);
	for (int32 Rank = 0; Rank < Order.Num(); ++Rank)
	{
		const int32 i = Order[Rank];
		Print(FString::Printf(TEXT("  #%d %-22s total %7.0f  (%.2f per round)"), Rank + 1, *StrategyName(Players[i]),
			TotalScore[i], TotalScore[i] / (RoundsPerMatch * Players.Num())), FColor::Yellow);
	}
}

// =====================================================================
// Debug console
// =====================================================================

void UGameTheorySubsystem::Print(const FString& Msg, FColor Color)
{
	UE_LOG(LogGameTheory, Display, TEXT("%s"), *Msg);
	if (GEngine)
	{
		GEngine->AddOnScreenDebugMessage(-1, 15.f, Color, Msg);
	}
}

bool UGameTheorySubsystem::ParseColony(const FString& Str, EColony& Out)
{
	const UEnum* Enum = StaticEnum<EColony>();
	for (int32 i = 0; i < Enum->NumEnums() - 1; ++i) // last entry is the hidden _MAX
	{
		if (Enum->GetNameStringByIndex(i).Equals(Str, ESearchCase::IgnoreCase))
		{
			Out = static_cast<EColony>(Enum->GetValueByIndex(i));
			return true;
		}
	}
	return false;
}

TArray<UClass*> UGameTheorySubsystem::GetAllStrategyClasses()
{
	TArray<UClass*> Result;
	for (TObjectIterator<UClass> It; It; ++It)
	{
		UClass* C = *It;
		if (C->IsChildOf(UStrategy::StaticClass()) && !C->HasAnyClassFlags(CLASS_Abstract)
			&& !C->GetName().StartsWith(TEXT("SKEL_")) && !C->GetName().StartsWith(TEXT("REINST_")))
		{
			Result.Add(C);
		}
	}
	Result.Sort([](const UClass& A, const UClass& B) { return A.GetName() < B.GetName(); });
	return Result;
}

UClass* UGameTheorySubsystem::FindStrategyClass(const FString& Name)
{
	for (UClass* C : GetAllStrategyClasses())
	{
		const FString Short = C->GetName().Replace(TEXT("Strategy_"), TEXT(""));
		if (Short.Equals(Name, ESearchCase::IgnoreCase) || C->GetName().Equals(Name, ESearchCase::IgnoreCase))
		{
			return C;
		}
	}
	return nullptr;
}

void UGameTheorySubsystem::RegisterConsoleCommands()
{
	IConsoleManager& CM = IConsoleManager::Get();
	auto Add = [&](const TCHAR* Name, const TCHAR* Help, void (UGameTheorySubsystem::*Fn)(const TArray<FString>&))
	{
		ConsoleCommands.Add(CM.RegisterConsoleCommand(Name, Help,
			FConsoleCommandWithArgsDelegate::CreateUObject(this, Fn), ECVF_Default));
	};

	Add(TEXT("LS.Play"), TEXT("LS.Play <Ironside|Mercy|Crows> <moves e.g. CCDCC> [MatrixRow=PD_Repeated]"), &UGameTheorySubsystem::Cmd_Play);
	Add(TEXT("LS.SetStrategy"), TEXT("LS.SetStrategy <Colony> <AlwaysCooperate|AlwaysDefect|TitForTat|GenerousTitForTat|GrimTrigger|Pavlov|Opportunist>"), &UGameTheorySubsystem::Cmd_SetStrategy);
	Add(TEXT("LS.Status"), TEXT("Show strategy, trust, hostility and history of every colony"), &UGameTheorySubsystem::Cmd_Status);
	Add(TEXT("LS.Solve"), TEXT("LS.Solve <PD|Chicken|StagHunt|Pennies|RowName>  or  LS.Solve CCp CCa CDp CDa DCp DCa DDp DDa"), &UGameTheorySubsystem::Cmd_Solve);
	Add(TEXT("LS.Commons"), TEXT("LS.Commons <Low|Medium|High> - run one day of the Tragedy of the Commons"), &UGameTheorySubsystem::Cmd_Commons);
	Add(TEXT("LS.PublicGoods"), TEXT("LS.PublicGoods <0-100> - run the Chapter 7 restart"), &UGameTheorySubsystem::Cmd_PublicGoods);
	Add(TEXT("LS.Tournament"), TEXT("LS.Tournament [rounds=200] - Axelrod round-robin of all strategies"), &UGameTheorySubsystem::Cmd_Tournament);
	Add(TEXT("LS.Reset"), TEXT("Wipe all colony memory"), &UGameTheorySubsystem::Cmd_Reset);
}

void UGameTheorySubsystem::Cmd_Play(const TArray<FString>& Args)
{
	EColony Colony;
	if (Args.Num() < 2 || !ParseColony(Args[0], Colony) || Colony == EColony::Lakeside)
	{
		Print(TEXT("Usage: LS.Play <Ironside|Mercy|Crows> <CCDCC...> [MatrixRow]"), FColor::Red);
		return;
	}
	const FName Row = Args.Num() >= 3 ? FName(*Args[2]) : FName(TEXT("PD_Repeated"));

	FString PlayerMoves, AIMoves;
	float PlayerTotal = 0.f, AITotal = 0.f;
	for (TCHAR Ch : Args[1].ToUpper())
	{
		if (Ch != TEXT('C') && Ch != TEXT('D')) continue;
		const FRoundRecord R = PlayRound(Colony, Ch == TEXT('C') ? EGTAction::Cooperate : EGTAction::Defect, Row, 0);
		PlayerMoves += ActionChar(R.PlayerAction);
		AIMoves += ActionChar(R.AIAction);
		PlayerTotal += R.PlayerPayoff;
		AITotal += R.AIPayoff;
	}
	Print(FString::Printf(TEXT("%s (%s)\n  You: %s  = %.0f\n  AI : %s  = %.0f\n  Trust %.1f  Hostility %d"),
		*ColonyName(Colony), *StrategyName(GetColonyStrategy(Colony)), *PlayerMoves, PlayerTotal, *AIMoves, AITotal,
		GetTrustScore(Colony), GetHostilityLevel(Colony)), FColor::Green);
}

void UGameTheorySubsystem::Cmd_SetStrategy(const TArray<FString>& Args)
{
	EColony Colony;
	UClass* Class = Args.Num() >= 2 ? FindStrategyClass(Args[1]) : nullptr;
	if (Args.Num() < 2 || !ParseColony(Args[0], Colony) || Colony == EColony::Lakeside || !Class)
	{
		TArray<FString> Names;
		for (UClass* C : GetAllStrategyClasses()) Names.Add(C->GetName().Replace(TEXT("Strategy_"), TEXT("")));
		Print(FString::Printf(TEXT("Usage: LS.SetStrategy <Ironside|Mercy|Crows> <%s>"), *FString::Join(Names, TEXT("|"))), FColor::Red);
		return;
	}
	SetColonyStrategy(Colony, Class);
	Print(FString::Printf(TEXT("%s now plays %s"), *ColonyName(Colony), *StrategyName(GetColonyStrategy(Colony))), FColor::Green);
}

void UGameTheorySubsystem::Cmd_Status(const TArray<FString>&)
{
	for (EColony C : AIColonies())
	{
		const TArray<FRoundRecord> H = GetHistory(C);
		FString You, Them;
		for (int32 i = FMath::Max(0, H.Num() - 20); i < H.Num(); ++i)
		{
			You += ActionChar(H[i].PlayerAction);
			Them += ActionChar(H[i].AIAction);
		}
		Print(FString::Printf(TEXT("%-9s %-20s trust %5.1f  stars %d  rounds %d  contrib %5.1f  | you %s | ai %s"),
			*ColonyName(C), *StrategyName(GetColonyStrategy(C)), GetTrustScore(C), GetHostilityLevel(C), H.Num(),
			GetAIContribution(C), *You, *Them), FColor::Cyan);
	}
	Print(FString::Printf(TEXT("River health %.0f%s | Player coop rate %.0f%%"),
		RiverHealth, bRiverDead ? TEXT(" (DEAD)") : TEXT(""), GetPlayerCooperationRate() * 100.f), FColor::Cyan);
}

void UGameTheorySubsystem::Cmd_Solve(const TArray<FString>& Args)
{
	FPayoffMatrix M;
	if (Args.Num() == 8)
	{
		M.GameName = FText::FromString(TEXT("Custom"));
		float* Fields[8] = { &M.CC_Player, &M.CC_AI, &M.CD_Player, &M.CD_AI, &M.DC_Player, &M.DC_AI, &M.DD_Player, &M.DD_AI };
		for (int32 i = 0; i < 8; ++i) *Fields[i] = FCString::Atof(*Args[i]);
	}
	else
	{
		M = GetPayoffMatrix(Args.Num() > 0 ? FName(*Args[0]) : FName(TEXT("PD")));
	}

	const FNashResult R = UNashSolver::SolveMatrix(M);
	Print(FString::Printf(TEXT("%s   [row = you, col = AI]\n              %-10s %-10s\n  %-10s (%g,%g)    (%g,%g)\n  %-10s (%g,%g)    (%g,%g)\n  %s"),
		*M.GameName.ToString(), *M.Action0Label.ToString().Left(10), *M.Action1Label.ToString().Left(10),
		*M.Action0Label.ToString().Left(10), M.CC_Player, M.CC_AI, M.CD_Player, M.CD_AI,
		*M.Action1Label.ToString().Left(10), M.DC_Player, M.DC_AI, M.DD_Player, M.DD_AI,
		*R.Summary), FColor::Yellow);
}

void UGameTheorySubsystem::Cmd_Commons(const TArray<FString>& Args)
{
	EExtraction Choice = EExtraction::Medium;
	if (Args.Num() > 0)
	{
		const FString A = Args[0].ToLower();
		Choice = A.StartsWith(TEXT("l")) ? EExtraction::Low : A.StartsWith(TEXT("h")) ? EExtraction::High : EExtraction::Medium;
	}
	const FCommonsDayResult R = RunCommonsDay(Choice);
	FString Line;
	for (const TPair<EColony, float>& G : R.Gains)
	{
		Line += FString::Printf(TEXT("%s +%.0f  "), *ColonyName(G.Key), G.Value);
	}
	Print(FString::Printf(TEXT("Day %d: %s| total %.0f vs regen %.0f | river %.0f -> %.0f%s"),
		R.Day, *Line, R.TotalExtraction, GetDefault<ULastSignalSettings>()->RiverRegenPerDay,
		R.HealthBefore, R.HealthAfter, R.bRiverDiedToday ? TEXT("  *** THE RIVER IS DEAD ***") : TEXT("")),
		R.bRiverDiedToday ? FColor::Red : FColor::Green);
}

void UGameTheorySubsystem::Cmd_PublicGoods(const TArray<FString>& Args)
{
	const float Mine = Args.Num() > 0 ? FCString::Atof(*Args[0]) : 100.f;
	const FPublicGoodsResult R = RunPublicGoods(Mine);
	FString Line;
	for (const TPair<EColony, float>& C : R.Contributions)
	{
		Line += FString::Printf(TEXT("%s %.0f  "), *ColonyName(C.Key), C.Value);
	}
	Print(FString::Printf(TEXT("Public goods: %s| total %.0f / %.0f -> %s"), *Line, R.TotalContribution, R.Threshold,
		R.bGridRestarted ? TEXT("GRID RESTARTED") : TEXT("RESTART FAILED")), R.bGridRestarted ? FColor::Green : FColor::Red);
}

void UGameTheorySubsystem::Cmd_Tournament(const TArray<FString>& Args)
{
	RunTournament(Args.Num() > 0 ? FMath::Max(1, FCString::Atoi(*Args[0])) : 200);
}

void UGameTheorySubsystem::Cmd_Reset(const TArray<FString>&)
{
	ResetAll();
	Print(TEXT("All colony memory wiped."), FColor::Orange);
}
