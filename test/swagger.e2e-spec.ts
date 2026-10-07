import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('Swagger (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  async function openApiDocument() {
    const res = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    return res.body;
  }

  it('serves Swagger UI at /api/docs', async () => {
    const res = await request(app.getHttpServer()).get('/api/docs').expect(200);

    expect(res.text).toContain('swagger-ui');
  });

  it('documents every endpoint under the /api/v1 prefix', async () => {
    const doc = await openApiDocument();

    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/me',
      '/api/v1/health',
      '/api/v1/purchase-requests',
      '/api/v1/purchase-requests/{id}',
      '/api/v1/purchase-requests/{id}/approve',
      '/api/v1/purchase-requests/{id}/audit',
      '/api/v1/purchase-requests/{id}/reject',
      '/api/v1/purchase-requests/{id}/submit',
    ]);
  });

  it('documents the login body fields as required', async () => {
    const doc = await openApiDocument();

    expect(doc.components.schemas.LoginDto).toMatchObject({
      required: ['tenantSlug', 'email', 'password'],
      properties: {
        tenantSlug: { type: 'string' },
        email: { type: 'string' },
        password: { type: 'string' },
      },
    });
  });

  it('marks guarded endpoints as needing a bearer token and leaves login open', async () => {
    const doc = await openApiDocument();

    expect(doc.components.securitySchemes.bearer).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(doc.paths['/api/v1/auth/me'].get.security).toEqual([{ bearer: [] }]);
    expect(doc.paths['/api/v1/auth/login'].post.security).toBeUndefined();
  });

  it('documents the error responses an endpoint can return', async () => {
    const doc = await openApiDocument();

    expect(
      Object.keys(doc.paths['/api/v1/auth/login'].post.responses).sort(),
    ).toEqual(['200', '400', '401']);
    expect(
      Object.keys(doc.paths['/api/v1/auth/me'].get.responses).sort(),
    ).toEqual(['200', '401']);
  });

  it('documents the purchase-request endpoints and their errors', async () => {
    const doc = await openApiDocument();
    const responses = (path: string, method: string) =>
      Object.keys(doc.paths[`/api/v1${path}`][method].responses).sort();

    expect(responses('/purchase-requests', 'post')).toEqual([
      '201',
      '400',
      '401',
    ]);
    for (const path of [
      '/purchase-requests/{id}',
      '/purchase-requests/{id}/audit',
    ]) {
      expect(responses(path, 'get')).toEqual(['200', '400', '401', '404']);
    }
    for (const method of ['patch', 'delete']) {
      expect(responses('/purchase-requests/{id}', method)).toEqual([
        method === 'patch' ? '200' : '204',
        '400',
        '401',
        '403',
        '404',
        '409',
      ]);
    }
    for (const action of ['submit', 'approve', 'reject']) {
      expect(responses(`/purchase-requests/{id}/${action}`, 'post')).toEqual([
        '200',
        '400',
        '401',
        '403',
        '404',
        '409',
      ]);
    }
    expect(doc.paths['/api/v1/purchase-requests'].post.security).toEqual([
      { bearer: [] },
    ]);
  });

  it('documents the purchase-request body fields', async () => {
    const doc = await openApiDocument();

    expect(doc.components.schemas.CreatePurchaseRequestDto).toMatchObject({
      required: ['title', 'vendor', 'amount', 'currency'],
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        vendor: { type: 'string' },
        amount: { type: 'integer' },
        currency: { type: 'string' },
      },
    });
    expect(doc.components.schemas.RejectPurchaseRequestDto).toMatchObject({
      required: ['reason'],
      properties: { reason: { type: 'string' } },
    });
  });
});
