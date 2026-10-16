import { expect, test } from "bun:test";
import { feedProperties, guideFeedXml, type FeedProperty } from "./feed";
const property = { id: 1, code: "AP-12", title: "Apartamento & varanda", purpose: "venda", type: "apartamento", price: 590000, condoFee: 500, iptu: 100, district: "Tupy", city: "Praia Grande", address: "ENDERECO PRIVADO", bedrooms: 2, suites: 2, bathrooms: 3, parking: 2, areaUtil: 89, areaTotal: null, description: "Descrição <real>", features: [], status: "disponivel", slug: "apartamento-12", updatedAt: null, images: [{url:"/foto.jpg", originalUrl:null,isPrimary:false}] } satisfies FeedProperty;
test("Guide preserves price, XML escaping, photo URL and hides private address", () => {
 const xml = guideFeedXml([property], {channel:"imovelguide",baseUrl:"https://example.com"});
 expect(xml).toContain("<PrecoVenda>590000</PrecoVenda>");
 expect(xml).toContain("Apartamento &amp; varanda");
 expect(xml).toContain("Descrição &lt;real&gt;");
 expect(xml).toContain("https://example.com/foto.jpg");
 expect(xml).toContain("<Principal>1</Principal>");
 expect(xml).not.toContain("ENDERECO PRIVADO");
 expect(xml).not.toContain("PrecoAluguel");
});
test("Guide eligibility requires explicit channel authorization and excludes sold/unpublished", async () => {
 let index=0;
 const data = [[{...property,published:1},{...property,id:2,status:"vendido",published:1},{...property,id:3,published:1}], [{propertyId:1,authorized:1},{propertyId:2,authorized:1}], []];
 const db = {select:()=>{const rows=data[index++];return {from:()=>({where:()=>Object.assign(Promise.resolve(rows),{orderBy:()=>Promise.resolve(rows)})})};}};
 const rows=await feedProperties(db as never,"imovelguide");
 expect(rows.map(p=>p.id)).toEqual([1]);
});
