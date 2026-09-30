import type { ListingInsight, SearchConditions } from '../../shared/types';
import { derive } from '../../shared/units';
import { collectListings, ensureHazard } from '../search/service';
import { evaluateListing } from '../search/scoring';
import { aiAvailable } from './ai';
import { buildAreaReport } from './area';
import { buildProposal } from './proposal';
import { buildRegulations } from './regulations';

export async function buildInsight(id: string, conditions: SearchConditions) {
  const { listings } = await collectListings();
  const listing = listings.find((l) => l.id === id);
  if (!listing) return undefined;

  const hazard = await ensureHazard(listing);
  const ev = evaluateListing(listing, conditions, hazard);
  const regulations = buildRegulations(listing);

  const sameCity = listings.filter((l) => l.prefecture === listing.prefecture && l.city === listing.city);
  const avg = sameCity.reduce((s, l) => s + derive(l.price, l.landArea).pricePerTsubo, 0) / (sameCity.length || 1);
  const area = await buildAreaReport(listing, hazard, ev.derived.pricePerTsubo, {
    cityAvgPricePerTsubo: avg,
    cityListingCount: sameCity.length,
  });

  const insight: ListingInsight = {
    listing,
    hazard,
    hazardError: hazard ? undefined : listing.lat == null ? '位置情報がないためハザードを判定できません' : 'ハザード情報を取得できませんでした',
    regulations,
    area,
    proposal: buildProposal(ev, hazard, regulations, area),
    aiAvailable: aiAvailable(),
  };
  return { insight, evaluated: ev };
}
