#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "GameTheory/GameTheoryTypes.h"
#include "GameTheory/NashSolver.h"
#include "GameTheorySubsystem.generated.h"

class UStrategy;
class IConsoleObject;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnRoundResolved, EColony, Colony, const FRoundRecord&, Record);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnTrustChanged, EColony, Colony, float, NewTrust);

/** Result of one in-game day of the Tragedy of the Commons (Chapter 3). */
USTRUCT(BlueprintType)
struct FCommonsDayResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Commons") int32 Day = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Commons") TMap<EColony, EExtraction> Choices;
	/** Individual gain = amount extracted. */
	UPROPERTY(BlueprintReadOnly, Category = "Commons") TMap<EColony, float> Gains;
	UPROPERTY(BlueprintReadOnly, Category = "Commons") float TotalExtraction = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Commons") float HealthBefore = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Commons") float HealthAfter = 0.f;
	/** Collective loss this day = health lost (negative if the river recovered). */
	UPROPERTY(BlueprintReadOnly, Category = "Commons") float CollectiveLoss = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "Commons") bool bRiverDiedToday = false;
};

/** Result of the Chapter 7 threshold Public Goods game. */
USTRUCT(BlueprintType)
struct FPublicGoodsResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "PublicGoods") TMap<EColony, float> Contributions;
	/** Final payoff = (Endowment - contribution) + (GridBenefit if restarted). */
	UPROPERTY(BlueprintReadOnly, Category = "PublicGoods") TMap<EColony, float> Payoffs;
	UPROPERTY(BlueprintReadOnly, Category = "PublicGoods") float TotalContribution = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "PublicGoods") float Threshold = 0.f;
	UPROPERTY(BlueprintReadOnly, Category = "PublicGoods") bool bGridRestarted = false;
};

/**
 * THE GAME THEORY ENGINE.
 *
 * A GameInstanceSubsystem lives as long as the game runs, across level loads,
 * so the colonies' memory is never lost when we stream between maps.
 * Access from Blueprint: Get Game Instance -> Get Subsystem (GameTheorySubsystem).
 */
UCLASS()
class LASTSIGNAL_API UGameTheorySubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	// ================= 2x2 games (Ch 1, 2, 4, 5, side missions) =================

	/**
	 * Play one simultaneous round against a colony.
	 * The AI decides from its history BEFORE seeing the player's move (simultaneous game),
	 * then the round is recorded and payoffs are assigned from the matrix.
	 */
	UFUNCTION(BlueprintCallable, Category = "GameTheory")
	FRoundRecord PlayRound(EColony Colony, EGTAction PlayerAction, FName MatrixRow, int32 Chapter);

	/** Look up a payoff matrix row. Falls back to the standard PD (T5 R3 P1 S0) if not found. */
	UFUNCTION(BlueprintPure, Category = "GameTheory")
	FPayoffMatrix GetPayoffMatrix(FName RowName) const;

	/** Convenience: solve the matrix for the Payoff Matrix screen. */
	UFUNCTION(BlueprintPure, Category = "GameTheory")
	FNashResult SolvePayoffMatrix(FName RowName) const;

	// ================= Trust / memory =================

	/** 0-100, recency-weighted cooperation rate of the player toward this colony. */
	UFUNCTION(BlueprintPure, Category = "GameTheory")
	float GetTrustScore(EColony Colony) const;

	/** GTA-style hostility stars, 0-5. */
	UFUNCTION(BlueprintPure, Category = "GameTheory")
	int32 GetHostilityLevel(EColony Colony) const;

	UFUNCTION(BlueprintPure, Category = "GameTheory")
	TArray<FRoundRecord> GetHistory(EColony Colony) const;

	/** Player's cooperation rate across all colonies (plain average, for the Strategy Report). */
	UFUNCTION(BlueprintPure, Category = "GameTheory")
	float GetPlayerCooperationRate() const;

	/** Recency-weighted cooperation rate in [0,100]. Weight of a round = Decay^(age). */
	static float ComputeTrust(const TArray<FRoundRecord>& Rounds, float Decay, float Initial);

	// ================= Strategies =================

	UFUNCTION(BlueprintCallable, Category = "GameTheory")
	void SetColonyStrategy(EColony Colony, TSubclassOf<UStrategy> StrategyClass);

	UFUNCTION(BlueprintPure, Category = "GameTheory")
	UStrategy* GetColonyStrategy(EColony Colony) const;

	// ================= Tragedy of the Commons (Ch 3) =================

	UFUNCTION(BlueprintCallable, Category = "GameTheory|Commons")
	FCommonsDayResult RunCommonsDay(EExtraction PlayerChoice);

	UFUNCTION(BlueprintPure, Category = "GameTheory|Commons")
	float GetRiverHealth() const { return RiverHealth; }

	UFUNCTION(BlueprintPure, Category = "GameTheory|Commons")
	bool IsRiverDead() const { return bRiverDead; }

	UFUNCTION(BlueprintPure, Category = "GameTheory|Commons")
	float GetExtractionAmount(EExtraction Level) const;

	// ================= Public Goods (Ch 7) =================

	/** What an AI colony would contribute right now (0-100). */
	UFUNCTION(BlueprintPure, Category = "GameTheory|PublicGoods")
	float GetAIContribution(EColony Colony) const;

	UFUNCTION(BlueprintCallable, Category = "GameTheory|PublicGoods")
	FPublicGoodsResult RunPublicGoods(float PlayerContribution);

	// ================= Save / Reset =================

	UFUNCTION(BlueprintCallable, Category = "GameTheory|Save")
	bool SaveProgress(const FString& SlotName = TEXT("LastSignal"));

	UFUNCTION(BlueprintCallable, Category = "GameTheory|Save")
	bool LoadProgress(const FString& SlotName = TEXT("LastSignal"));

	/** Wipe all memory and restore default strategies. */
	UFUNCTION(BlueprintCallable, Category = "GameTheory")
	void ResetAll();

	// ================= Events =================

	UPROPERTY(BlueprintAssignable, Category = "GameTheory")
	FOnRoundResolved OnRoundResolved;

	UPROPERTY(BlueprintAssignable, Category = "GameTheory")
	FOnTrustChanged OnTrustChanged;

	/** The three AI colonies, in a fixed order. */
	static const TArray<EColony>& AIColonies();

	/** Simulate an Axelrod-style round-robin tournament between every strategy class. */
	void RunTournament(int32 RoundsPerMatch);

private:
	UPROPERTY() TMap<EColony, TObjectPtr<UStrategy>> Strategies;
	UPROPERTY() TMap<EColony, FColonyHistory> Histories;
	UPROPERTY() TMap<EColony, float> ResourceScore;

	float RiverHealth = 100.f;
	bool bRiverDead = false;
	int32 CommonsDay = 0;

	FRandomStream Rng;

	// ---- Debug console commands (type in the ~ console) ----
	TArray<IConsoleObject*> ConsoleCommands;
	void RegisterConsoleCommands();
	void Cmd_Play(const TArray<FString>& Args);
	void Cmd_SetStrategy(const TArray<FString>& Args);
	void Cmd_Status(const TArray<FString>& Args);
	void Cmd_Solve(const TArray<FString>& Args);
	void Cmd_Commons(const TArray<FString>& Args);
	void Cmd_PublicGoods(const TArray<FString>& Args);
	void Cmd_Tournament(const TArray<FString>& Args);
	void Cmd_Reset(const TArray<FString>& Args);

	static void Print(const FString& Msg, FColor Color = FColor::Cyan);
	static bool ParseColony(const FString& Str, EColony& Out);
	static UClass* FindStrategyClass(const FString& Name);
	static TArray<UClass*> GetAllStrategyClasses();
};
