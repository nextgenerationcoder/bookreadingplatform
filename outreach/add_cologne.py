import openpyxl
wb = openpyxl.load_workbook('ginger_shoc_outreach_tracker.xlsx')

ws = wb.create_sheet('Cologne')
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']
ws.append(headers)

rows = [
('Cologne','Teeladen','Teequartier 259','Venloer Str. 259, 50823 Köln','+49 221 58919365','4.7','https://teequartier.de/','shop@teequartier.de','Found','Independent since 2010, Ehrenfeld, run by Gerna GmbH.'),
('Cologne','Teeladen','Tee de Cologne','Landmannstraße 30, 50823 Köln','TBD','4.4','https://www.tee-de-cologne.de/','Contact via tee-de-cologne.de — no public email found','Partial','200+ teas incl. Twinings, Ehrenfeld.'),
('Cologne','Teeladen','Teehaus Cöln','Innenstadt, Köln (exact address TBD)','TBD','TBD','https://www.teehaus.com/','Contact via teehaus.com — needs follow-up for exact address/email','Not started',None),
('Cologne','Geschenkartikel','koelngeschenk (Elke Kruse)','Deutzer Freiheit 91, 50679 Köln','+49 221 1683745','4.5','https://www.koelngeschenk.de/','info@koelngeschenk.de','Found','Owner-run family business, Cologne-themed gifts, ~80m² store + 24/7 online shop.'),
('Cologne','Geschenkartikel','Kölner Domshop','Am Dom, 50667 Köln (Cathedral gift shop)','TBD','4.2','https://www.koelner-domshop.de/','Contact via koelner-domshop.de — no public email found','Partial','Official Cologne Cathedral souvenir/gift shop — high foot traffic, may be tied to Cathedral chapter/tourism board rather than a private buyer.'),
('Cologne','Souvenirladen','Souvenir Point','Near Cologne Cathedral, 50667 Köln (exact address TBD)','TBD','4.3','TBD — no dedicated website found','TBD','Not started','Family-run souvenir shop, 18+ years near the Dom.'),
('Cologne','Souvenirladen','Michael Kruse – Kölsche Geschenkartikel','Köln (exact address TBD)','TBD','TBD','https://www.mk-koelschegeschenkartikel.de/','Contact via mk-koelschegeschenkartikel.de — no public email found','Partial','Related family business to koelngeschenk (Elke Kruse) above — verify relationship before treating as separate lead.'),
('Cologne','Bioladen','NATURATA Köln-Sülz','Berrenrather Str. 201, 50937 Köln','+49 221 944023-0','4.5','https://www.naturata-bioladen.de/','info@naturata-koeln.de','Found','One of the founding NATURATA stores (since 1982); NATURATA GmbH HQ at Krebsgasse 5-11, Köln — could be a multi-store regional chain contact.'),
('Cologne','Reformhaus','Reformhaus Bach (Georg Bach GmbH & Co. KG)','Longericher Str. 441, 50739 Köln','+49 221 5991978','4.4','https://reformhaus-bach.de/','info@bach-koeln.de','Found','Independent, family-run since 1958, Köln-Longerich.'),
('Cologne','Reformhaus','Reformhaus Dahmen','Frankfurter Str. 46, 50931 Köln','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent, Köln-Mülheim.'),
('Cologne','Apotheke','Dom Apotheke','Bahnhofsvorplatz 1, 50667 Köln','+49 221 20050500','4.3','https://dom-apotheke-koeln.de/','info@dom-apotheke-koeln.de','Found','Located directly at Cologne Cathedral/Hauptbahnhof — very high footfall.'),
('Cologne','Apotheke','Apotheke am Neumarkt','Neumarkt 2, 50667 Köln','+49 221 2727340','4.4','https://www.apo-am-neumarkt.de/','info@apo-am-neumarkt.de','Found','Note: Heilmittelwerbegesetz (HWG) restricts pharmacy advertising in Germany, in addition to UWG/GDPR.'),
]

for r in rows:
    ws.append(r)

wb.save('ginger_shoc_outreach_tracker.xlsx')
print('Cologne rows written:', len(rows))
