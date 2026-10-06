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
});
