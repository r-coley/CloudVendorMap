function docReady(fn) {
	// see if DOM is already available
	if (document.readyState === "complete" || document.readyState === "interactive") {
		// call on next available tick
		setTimeout(fn, 1);
	} else {
		document.addEventListener("DOMContentLoaded", fn);
	}
}    

function IncludeHTML() {
	var z, i, elmnt, file, xhttp;

	/*loop through a collection of all HTML elements:*/
	z = document.getElementsByTagName("*");
	for (i = 0; i < z.length; i++) {
		elmnt = z[i];
		/*search for elements with a certain attribute:*/
		file = elmnt.getAttribute("w3-include-html");
		if (file) {
			/*make an HTTP request using the attribute value as the file name:*/
			xhttp = new XMLHttpRequest();
			xhttp.onreadystatechange = function() {
				if (this.readyState == 4) {
					if (this.status == 200) {elmnt.innerHTML = this.responseText;}
					if (this.status == 404) {elmnt.innerHTML = "Page not found.";}
					/*remove the attribute, and call this function once more:*/
					elmnt.removeAttribute("w3-include-html");
					IncludeHTML();
				}
			}      
			xhttp.open("GET", file, true);
			xhttp.send();
			/*exit the function:*/
			return;
		}
	}
}

function Toggle(el,classname) { 
	el.classList.toggle(classname) 
}

function OpenNewWindow(url) { 
	window.open(url,'_blank','resizable=yes') 
}

/*** Initial State of Buttons ***/
var aws=0,ali=0,azure=0,gcp=0;	

docReady(function() {
	/*** Object: Draws a circle ***/
	function Dot(Paper,x,y,radius,color,msg) {
		this.cx = x;
		this.cy = y;
		this.rad = radius;
		this.color = color;
		this.run = 1;
		this.dot = Paper.circle(this.cx,this.cy,this.rad).attr({"fill":this.color,"opacity":1,"stroke":"none"});
		this.msg = msg;

		if (msg) {
			var point=this.dot;
			point.node.onmouseover = function () {
				if (popup1) {popup1.remove()}
				popup1 = Paper.popup(x,y,msg,(x>350?'left':'right'));
			}
			point.node.onmouseout = function () {
				if (popup1) {
					popup1.remove();
					popup1=null;
				}
			}
		}

		// *** Pulse or start the Wave effect ***
		this.Pulse = function(o) {
			var that = this;
			this.wave = Paper.circle(this.cx,this.cy,this.rad).attr({
				"stroke":this.color,
				"stroke-width":2,
				"opacity":0.4
			});
			
			var fadeReset = function() { 
				that.wave.attr({r: that.rad}); 
				if (that.run) fadeOut(); 
			}
			var fadeOut = function() { 
				that.wave.animate({r: that.rad*3 },1000, "", fadeReset);
			}
			that.run=1;
			fadeReset();
		}

		// *** Stop the Wave effect ***
		this.Stop = function(o) { this.run=0; }
		return this;
	}

	/*** Object: Draws a country ***/
	function Country(Paper,country,color,docapital) {
		var animateOver = function() { 
			if (this.data("hoverFill")) {
				this.attr("fill", this.data("hoverFill"));
			}
		}
		var animateOut = function() {
			if (this.data("fill")) {
				this.attr("fill", this.data("fill"));
			}
		}
		var obj = rr.path(WORLD[country].path).attr({
			"fill": color,
			"stroke": '#ccc6ae',
			"stroke-opacity": 0.25,
			"stroke-width": "0.1px"
		});
		//obj.click(handleDetails);
		obj.data("hoverFill", "#4C555A"); 
		obj.data("fill", color); 
		obj.hover(animateOver, animateOut);

		if (WORLD[country].name) {
			var msg = WORLD[country].name;
			obj.node.onmouseover = function (ev) {
				if (popup2) {popup2.remove()};
				popup2 = rr.popup(ev.offsetX,ev.offsetY,msg,
					(ev.offsetX>350?'left':'right'));
			}
			obj.node.onmouseout = function () {
				if (popup2) {
					popup2.remove();
					popup2=null;
				};
			}
		}
		if (docapital) {
			if (WORLD[country].capital) {
				var attr = parseLatLon(WORLD[country].capital[0]);
				var name = WORLD[country].capital[1];
				obj.capital=new Dot(rr,attr.cx,attr.cy,2,"purple",name);
			}
		}
		return obj;
	}

	function parseLatLon(latlon) {
		var getXY = function(lat,lon) {
			return { 
				cx: lon * 2.6938+465.4, 
				cy: lat * -2.6938+227.066 
			};
		}
		var l = latlon.split(",");
		return getXY(l[0],l[1]);
	}
	function showCSPlocations(Paper) {
		for(var i = 0; i < CSP.length; i++) {
			var attr = parseLatLon(CSP[i].coord);
			var msg = CSP[i].csp+"\n"+CSP[i].location;
			var col="";
			switch (CSP[i].csp) {
			case "AWS":   col="#ffb70e"; attr.cy-=1; break;
			case "Azure": col="blue";    attr.cx-=1; break;
			case "GCP":   col="#24b824"; attr.cx+=1; break;
			case "ALI":   col="yellow";  attr.xc-=1; break;
			}

			loc = new Dot(rr,attr.cx,attr.cy,3,col,msg);
			//loc.Pulse(); 

			switch (CSP[i].csp) {
			case "AWS":   awsSet.push(loc); break;
			case "Azure": azureSet.push(loc); break;
			case "GCP":   gcpSet.push(loc); break;
			case "ALI":   aliSet.push(loc); break;
			}
		}
	    //alert("aliSet: "+aliSet.length+" awsSet: "+awsSet.length+" azureSet: "+azureSet.length+" gcpSet: "+gcpSet.length);
	}
	function DrawMap(Paper) {
		for (var country in WORLD) {
			WORLD[country].obj=Country(Paper,country,"#EEE6ED",1);
		}
		showCSPlocations(Paper);
	}

	/*** Main Code ***/
	var w=document.querySelector("#mapContainer #map").clientWidth;
	var h=document.querySelector("#mapContainer #map").clientHeight;
	var rr = Raphael('map', w, h);
	var panZoom = rr.panzoom({ initialZoom: 0, initialPosition: { x: 120, y: 70} });
	var popup1 = null, popup2 = null;
	var aliSet=[], awsSet=[], azureSet=[], gcpSet=[];
	
	panZoom.enable();
	/*** Clear the background ***/
	var overlay = rr.rect(0, 0, rr.width, rr.height).attr({ 
		//"fill": "#505250",
		//"fill": "#0378B4",
		"fill": "#65BCEA",
		"stroke": "none",		
		"fill-opacity": 1,
		"stroke-width": 0 
	});

	DrawMap(rr);

	/*** Buttons to control which CSP locations to show ***/
	document.querySelector("#mapButtons #ali").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("aliSet: "+aliSet.length);
		ali=(ali==0)?1:0;
		for(var j=0; j<aliSet.length; j++) {
			var obj=aliSet[j];
			switch(ali) {
			case 0: obj.Stop(); break;
			case 1: obj.Pulse(); break;
			}
		}

		/*** Following two lines show how to change ***/
		//WORLD["CA"].obj.attr({"fill":"yellow"});
		//WORLD["CA"].obj.capital.Pulse();
	});
	document.querySelector("#mapButtons #aws").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("awsSet: "+awsSet.length);
		aws=(aws==0)?1:0;
		for(var j=0; j<awsSet.length; j++) {
			var obj=awsSet[j];
			switch(aws) {
			case 0: obj.Stop(); break;
			case 1: obj.Pulse(); break;
			}
		}
	});
	document.querySelector("#mapButtons #azure").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("azureSet: "+azureSet.length);
		azure=(azure==0)?1:0;
		for(var j=0; j<azureSet.length; j++) {
			var obj=azureSet[j];
			switch(azure) {
			case 0: obj.Stop(); break;
			case 1: obj.Pulse(); break;
			}
		}
	});
	document.querySelector("#mapButtons #gcp").addEventListener('click',(e) => {
		Toggle(e.target,"pressed");
	    	//alert("gcpSet: "+gcpSet.length);
		gcp=(gcp==0)?1:0;
		for(var j=0; j<gcpSet.length; j++) {
			var obj=gcpSet[j];
			switch(gcp) {
			case 0: obj.Stop(); break;
			case 1: obj.Pulse(); break;
			}
		}
	});

	/*** Links to the vendor pages ***/
	document.querySelector("#mapButtons #Cali").addEventListener('click',(e) => {
		OpenNewWindow("https://www.google.com");
	});
	document.querySelector("#mapButtons #Caws").addEventListener('click',(e) => {
		OpenNewWindow("https://health.aws.amazon.com/health/status");
	});
	document.querySelector("#mapButtons #Cazure").addEventListener('click',(e) => {
		OpenNewWindow("https://azure.status.microsoft/en-gb/status");
	});
	document.querySelector("#mapButtons #Cgcp").addEventListener('click',(e) => {
		OpenNewWindow("https://status.cloud.google.com");
	});

	/*** PanZoom controls ***/
	document.querySelector("#mapContainer #plus").addEventListener('click',(e) => {
		panZoom.zoomIn(1);
		e.preventDefault();
	});
	document.querySelector("#mapContainer #minus").addEventListener('click',(e) => {
		panZoom.zoomOut(1);
		e.preventDefault();
	});
	document.querySelector("#mapContainer #home").addEventListener('click',(e) => {
		panZoom.zoomOut( panZoom.getCurrentZoom() );
	});
});
