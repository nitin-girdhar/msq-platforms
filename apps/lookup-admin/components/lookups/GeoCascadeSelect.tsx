'use client';

import { useEffect, useState } from 'react';
import { lookupAdmin } from '@/src/lib/api/client';

interface GeoOption {
  id: string;
  name: string;
}

export interface GeoValues {
  country_id: string;
  state_id: string;
  city_id: string;
}

interface Props {
  values: GeoValues;
  onChange: (values: GeoValues) => void;
  disabled?: boolean;
  idPrefix: string;
}

// Cascading Country -> State -> City selects backing the 'geo-select' field
// type. Fetches countries once on mount; fetches states whenever the selected
// country changes (also pre-loading for an existing country_id on first
// mount, so Edit mode shows correct pre-selected values instead of empty
// selects); same for cities off the selected state.
export default function GeoCascadeSelect({ values, onChange, disabled, idPrefix }: Props) {
  const [countries, setCountries] = useState<GeoOption[]>([]);
  const [states, setStates] = useState<GeoOption[]>([]);
  const [cities, setCities] = useState<GeoOption[]>([]);

  useEffect(() => {
    lookupAdmin.geo.countries()
      .then((res) => setCountries(res.data.map((c) => ({ id: String(c.id), name: c.name }))))
      .catch(() => setCountries([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load states for the current country (covers both a user-driven change and
  // the initial pre-fill from an existing row in Edit mode).
  useEffect(() => {
    if (!values.country_id) {
      setStates([]);
      return;
    }
    lookupAdmin.geo.states(values.country_id)
      .then((res) => setStates(res.data.map((s) => ({ id: String(s.id), name: s.name }))))
      .catch(() => setStates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.country_id]);

  // Load cities for the current state (same dual purpose as above).
  useEffect(() => {
    if (!values.state_id) {
      setCities([]);
      return;
    }
    lookupAdmin.geo.cities(values.state_id)
      .then((res) => setCities(res.data.map((c) => ({ id: String(c.id), name: c.name }))))
      .catch(() => setCities([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.state_id]);

  const handleCountryChange = (countryId: string) => {
    onChange({ country_id: countryId, state_id: '', city_id: '' });
  };

  const handleStateChange = (stateId: string) => {
    onChange({ ...values, state_id: stateId, city_id: '' });
  };

  const handleCityChange = (cityId: string) => {
    onChange({ ...values, city_id: cityId });
  };

  const selectClass =
    'rounded-xl border border-[#E2E8F0] bg-white px-3 py-2.5 text-sm text-[#0F172A] shadow-sm focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20 disabled:cursor-not-allowed disabled:bg-[#F8FAFC]';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-country`} className="text-xs font-semibold text-[#0F172A]">Country</label>
        <select
          id={`${idPrefix}-country`}
          value={values.country_id}
          onChange={(e) => handleCountryChange(e.target.value)}
          disabled={disabled}
          className={selectClass}
        >
          <option value="">— Select Country —</option>
          {countries.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-state`} className="text-xs font-semibold text-[#0F172A]">State</label>
        <select
          id={`${idPrefix}-state`}
          value={values.state_id}
          onChange={(e) => handleStateChange(e.target.value)}
          disabled={disabled || !values.country_id}
          className={selectClass}
        >
          <option value="">— Select State —</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${idPrefix}-city`} className="text-xs font-semibold text-[#0F172A]">City</label>
        <select
          id={`${idPrefix}-city`}
          value={values.city_id}
          onChange={(e) => handleCityChange(e.target.value)}
          disabled={disabled || !values.state_id}
          className={selectClass}
        >
          <option value="">— Select City —</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
