#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "GameTheory/GameTheoryTypes.h"
#include "LastSignalSettings.generated.h"

class UStrategy;
class UDataTable;

/**
 * All tunable game-theory numbers in one place.
 * Edit in: Project Settings -> Game -> Last Signal - Game Theory.
 * Saved to Config/DefaultGame.ini.
 */
UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Last Signal - Game Theory"))
class LASTSIGNAL_API ULastSignalSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	ULastSignalSettings();

	virtual FName GetCategoryName() const override { return TEXT("Game"); }

	// ---------- Strategies ----------

	/** Which strategy each AI colony uses. Swap here for the viva demo. */
	UPROPERTY(Config, EditAnywhere, Category = "Strategies")
	TMap<EColony, TSubclassOf<UStrategy>> ColonyStrategies;

	/** Data Table (row struct FPayoffMatrix) holding every chapter's payoff matrix. */
	UPROPERTY(Config, EditAnywhere, Category = "Payoffs", meta = (RequiredAssetDataTags = "RowStructure=/Script/LastSignal.PayoffMatrix"))
	TSoftObjectPtr<UDataTable> PayoffTable;

	/** 0 = random seed every session. Any other value = reproducible runs (handy for the demo). */
	UPROPERTY(Config, EditAnywhere, Category = "Strategies")
	int32 RandomSeed = 0;

	// ---------- Trust ----------

	/** Weight multiplier per round of age. 0.8 => last round weight 1, previous 0.8, then 0.64 ... */
	UPROPERTY(Config, EditAnywhere, Category = "Trust", meta = (ClampMin = "0.01", ClampMax = "1"))
	float TrustRecencyDecay = 0.8f;

	/** Trust before any rounds are played. */
	UPROPERTY(Config, EditAnywhere, Category = "Trust", meta = (ClampMin = "0", ClampMax = "100"))
	float InitialTrust = 50.f;

	// ---------- Tragedy of the Commons (Chapter 3) ----------

	UPROPERTY(Config, EditAnywhere, Category = "Commons") float RiverStartHealth = 100.f;
	UPROPERTY(Config, EditAnywhere, Category = "Commons") float RiverRegenPerDay = 15.f;
	UPROPERTY(Config, EditAnywhere, Category = "Commons") float ExtractLow = 5.f;
	UPROPERTY(Config, EditAnywhere, Category = "Commons") float ExtractMedium = 10.f;
	UPROPERTY(Config, EditAnywhere, Category = "Commons") float ExtractHigh = 20.f;
	UPROPERTY(Config, EditAnywhere, Category = "Commons") float RiverDeathPenalty = 50.f;

	// ---------- Public Goods (Chapter 7) ----------

	UPROPERTY(Config, EditAnywhere, Category = "PublicGoods") float Endowment = 100.f;
	UPROPERTY(Config, EditAnywhere, Category = "PublicGoods") float RestartThreshold = 280.f;
	/** Benefit every colony receives if the grid restarts (whether it contributed or not -> free-rider problem). */
	UPROPERTY(Config, EditAnywhere, Category = "PublicGoods") float GridBenefit = 150.f;
};
