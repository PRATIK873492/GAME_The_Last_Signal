#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "GameTheory/GameTheoryTypes.h"
#include "LastSignalSaveGame.generated.h"

/** Everything the Game Theory engine needs to resume a playthrough. */
UCLASS()
class LASTSIGNAL_API ULastSignalSaveGame : public USaveGame
{
	GENERATED_BODY()

public:
	/** Every round played against every colony (the AI "memory"). */
	UPROPERTY() TMap<EColony, FColonyHistory> Histories;

	/** Strategy class per colony, so live swaps made in demo mode survive a reload. */
	UPROPERTY() TMap<EColony, FSoftClassPath> Strategies;

	/** Accumulated resource points (Commons / Public Goods payoffs). */
	UPROPERTY() TMap<EColony, float> ResourceScore;

	UPROPERTY() float RiverHealth = 100.f;
	UPROPERTY() bool bRiverDead = false;
	UPROPERTY() int32 CommonsDay = 0;
	UPROPERTY() int32 CurrentChapter = 0;
};
