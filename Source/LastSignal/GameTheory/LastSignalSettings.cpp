#include "GameTheory/LastSignalSettings.h"
#include "GameTheory/Strategies/Strategies.h"

ULastSignalSettings::ULastSignalSettings()
{
	// Default casting from the design doc (Section 2).
	ColonyStrategies.Add(EColony::Ironside, UStrategy_GrimTrigger::StaticClass());
	ColonyStrategies.Add(EColony::Mercy, UStrategy_GenerousTitForTat::StaticClass());
	ColonyStrategies.Add(EColony::Crows, UStrategy_Opportunist::StaticClass());
}
