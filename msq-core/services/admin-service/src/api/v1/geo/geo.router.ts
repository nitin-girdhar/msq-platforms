import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../../middleware/auth.middleware.js';
import { validate } from '../../../middleware/validate.middleware.js';
import {
  createCountrySchema,
  updateCountrySchema,
  createStateSchema,
  updateStateSchema,
  createCitySchema,
  updateCitySchema,
} from './geo.schema.js';
import { GeoController } from './geo.controller.js';

// The slugs match the `endpoint` union in lookup-admin's lookupTableConfig.ts,
// which already knew about geo-countries/geo-states/geo-cities as FK sources —
// these routes make them editable tables too.
//
// No DELETE: geo rows are referenced ON DELETE RESTRICT, and 07_grants.sql
// grants no DELETE on geo. Removing a place is PATCH { is_active: false }.
export async function geoRouter(app: FastifyInstance) {
  const ctrl = new GeoController();

  app.get('/lookups/geo-countries',       { preHandler: [authenticate] }, ctrl.listCountries);
  app.post('/lookups/geo-countries',      { preHandler: [authenticate, validate({ body: createCountrySchema })] }, ctrl.createCountry);
  app.patch('/lookups/geo-countries/:id', { preHandler: [authenticate, validate({ body: updateCountrySchema })] }, ctrl.updateCountry);

  app.get('/lookups/geo-states',          { preHandler: [authenticate] }, ctrl.listStates);
  app.post('/lookups/geo-states',         { preHandler: [authenticate, validate({ body: createStateSchema })] }, ctrl.createState);
  app.patch('/lookups/geo-states/:id',    { preHandler: [authenticate, validate({ body: updateStateSchema })] }, ctrl.updateState);

  app.get('/lookups/geo-cities',          { preHandler: [authenticate] }, ctrl.listCities);
  app.post('/lookups/geo-cities',         { preHandler: [authenticate, validate({ body: createCitySchema })] }, ctrl.createCity);
  app.patch('/lookups/geo-cities/:id',    { preHandler: [authenticate, validate({ body: updateCitySchema })] }, ctrl.updateCity);
}
