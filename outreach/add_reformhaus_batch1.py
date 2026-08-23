import openpyxl
path = '/home/user/bookreadingplatform/outreach/ginger_shoc_outreach_tracker.xlsx'
wb = openpyxl.load_workbook(path)
headers = ['City', 'Category', 'Shop Name', 'Address', 'Phone', 'Rating', 'Website', 'Contact Email / Form', 'Outreach Status', 'Notes']

# Cologne: add one more Reformhaus found
ws = wb['Cologne']
ws.append(('Cologne','Reformhaus','Reformhaus (Richmodstraße)','Richmodstr. 4-8, 50667 Köln','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent branch, city center — verify chain affiliation.'))

def new_sheet(name):
    ws = wb.create_sheet(name)
    ws.append(headers)
    return ws

ws = new_sheet('Stuttgart')
rows = [
('Stuttgart','Reformhaus','VITALIA Reformhaus (Hirschstraße)','Hirschstraße 18, 70173 Stuttgart','TBD','TBD','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ — same VITALIA chain contact reused from Berlin/Hamburg/Munich)','Partial','VITALIA chain branch, central Stuttgart.'),
('Stuttgart','Reformhaus','VITALIA Reformhaus (Sillenbuch)','Kirchheimer Straße 50, Stuttgart-Sillenbuch','TBD','TBD','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ)','Partial','Same VITALIA chain — reuse contact.'),
('Stuttgart','Reformhaus','Reformhaus (Klettpassage)','Klettpassage 14, 70173 Stuttgart-Mitte','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent branch in main train station passage — verify chain affiliation.'),
('Stuttgart','Reformhaus','Reformhaus Escher (Vita Nova) – Bad Cannstatt','Marktstr. 48, 70372 Stuttgart','+49 711 565928','TBD','https://www.vita-nova.de/standorte/reformhaus-escher/','info@reformhaus-escher.de','Found','Vita Nova chain (HQ Pirmasens) — reuse for other Escher branches.'),
('Stuttgart','Reformhaus','Reformhaus Escher (Vita Nova) – Weilimdorf','Köstlinstraße 5, 70499 Stuttgart','+49 711 8499088','TBD','https://www.vita-nova.de/standorte/reformhaus-escher/','info@reformhaus-escher.de','Found','Same Vita Nova/Escher chain as Bad Cannstatt branch.'),
]
for r in rows: ws.append(r)

ws = new_sheet('Düsseldorf')
rows = [
('Düsseldorf','Reformhaus','Reformhaus (Am Wehrhahn)','Am Wehrhahn 15, 40211 Düsseldorf-Stadtmitte','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent branch — verify chain affiliation.'),
('Düsseldorf','Reformhaus','Reformhaus Bacher','Rethelstraße 166, 40237 Düsseldorf','+49 211 627263','TBD','https://reformhaus.de/blogs/reformhaus-bacher/','mail@reformhaus-bacher.de','Found','Chain (Reformhaus Bacher GmbH & Co. KG, admin office Erkrath) — also present in Cologne/Bergisch region; reuse contact for other Bacher branches.'),
('Düsseldorf','Reformhaus','Reformhaus GOLL (Zentrum/Unterbilk)','Friedrichstraße 11, 40217 Düsseldorf','+49 211 382802','TBD','https://reformhaus.de/blogs/reformhaus-goll/','Goll-FS-Friedrichstrasse@reformhaus-goll.de (branch) / info@reformhaus-goll.de (HQ)','Found','Chain HQ in Mönchengladbach (Mittelstraße 12) — reuse HQ contact for other GOLL branches incl. Mönchengladbach.'),
('Düsseldorf','Reformhaus','Reformhaus GOLL (Kaiserswerth)','Klemensplatz 1, 40489 Düsseldorf','+49 211 4059557','TBD','https://reformhaus.de/blogs/reformhaus-goll/','Goll-KW-Klemensplatz@reformhaus-goll.de','Found','Same GOLL chain as Zentrum branch.'),
('Düsseldorf','Reformhaus','Reformhaus GOLL (Oberkassel)','Luegallee 108a, 40545 Düsseldorf','+49 211 570423','TBD','https://reformhaus.de/blogs/reformhaus-goll/','kontakt@reformhaus-goll.de','Found','Same GOLL chain as above.'),
]
for r in rows: ws.append(r)

ws = new_sheet('Leipzig')
rows = [
('Leipzig','Reformhaus','VITALIA Reformhaus (Willy-Brandt-Platz)','Willy-Brandt-Platz 5, 04109 Leipzig','TBD','TBD','https://www.vitalia-reformhaus.de/','shop@vitalia-reformhaus.de (HQ)','Partial','Same VITALIA chain — reuse contact.'),
('Leipzig','Reformhaus','Reformhaus Sonntag','Dresdner Str. 79, 04317 Leipzig','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent — verify chain affiliation.'),
('Leipzig','Reformhaus','Reformhaus Blicke (Ritterstraße)','Ritterstr. 5, 04109 Leipzig','TBD','TBD','TBD — no dedicated website found','TBD','Not started','Independent local chain (2 Leipzig locations) — verify chain affiliation.'),
('Leipzig','Reformhaus','Reformhaus Blicke (Friedrich-Ebert-Str.)','Friedrich-Ebert-Str. 33, 04109 Leipzig','+49 341 2536203','TBD','TBD — no dedicated website found','TBD','Not started','Same Blicke chain as Ritterstraße branch.'),
]
for r in rows: ws.append(r)

ws = new_sheet('Dortmund')
rows = [
('Dortmund','Reformhaus','Reformhaus Göschel','Harkortstraße 29, 44225 Dortmund-Hombruch','+49 231 97100008','TBD','https://www.reformhaus-goeschel.de/','Contact via reformhaus-goeschel.de — no public email found','Partial','Also serves Schwerte area.'),
('Dortmund','Reformhaus','Reformhaus Kimm','Westenhellweg 121, 44137 Dortmund','+49 231 3962741','TBD','https://reformhaus.de/blogs/reformhaus-kimm/','info@reformhaus-kimm.de','Found','Reformhaus® Westenhellweg Peter Kimm GmbH, city center pedestrian zone.'),
('Dortmund','Reformhaus','Reformhaus Kirchlinde (A. Ogniwek u. I. Rothardt)','Egilmarstr. 2, 44379 Dortmund','+49 231 7267228','TBD','TBD — no dedicated website found','TBD','Not started','Independent, Kirchlinde district.'),
]
for r in rows: ws.append(r)

wb.save(path)
print('batch1 done')
