import {test,expect} from 'bun:test';
import {authorizationAccess,recipientAuthorizationUrl} from './standalone-authorization-client';
test('recipient links never contain the private owner key',()=>{
 const owner='a'.repeat(64),token='b'.repeat(64);expect(authorizationAccess('#particular='+owner)).toEqual({owner,token:null});expect(authorizationAccess('#a='+token)).toEqual({owner:null,token});
 for(const kind of ['venda','locacao'] as const){const link=recipientAuthorizationUrl('https://www.esantoscorretor.com.br',kind,token);expect(link).not.toContain(owner);expect(link).not.toContain('particular');expect(authorizationAccess(new URL(link).hash)).toEqual({owner:null,token});}
 expect(authorizationAccess('#a=invalid&particular=invalid')).toEqual({owner:null,token:null});
});
